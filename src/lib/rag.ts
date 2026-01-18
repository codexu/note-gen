import { readTextFile, readDir, BaseDirectory, DirEntry } from "@tauri-apps/plugin-fs";
import { fetchEmbedding, rerankDocuments } from "./ai";
import {
  upsertVectorDocument,
  deleteVectorDocumentsByFilename,
  getSimilarDocuments,
  initVectorDb
} from "@/db/vector";
import { invoke } from "@tauri-apps/api/core";

// 重新导出initVectorDb，使其可在其他模块中导入
export { initVectorDb };
import { getFilePathOptions, getWorkspacePath } from "./workspace";
import { DirTree } from "@/stores/article";
import { toast } from "@/hooks/use-toast";
import { join } from "@tauri-apps/api/path";
import { Store } from "@tauri-apps/plugin-store";
import { createHash } from 'crypto';
import { isSkillsFolder } from './skills/utils';

/**
 * 统一错误处理函数
 */
function handleRAGError(error: unknown, context: string, showToast: boolean = true): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[RAG Error] ${context}:`, errorMessage);

  if (showToast) {
    toast({
      title: 'RAG 功能错误',
      description: `${context}: ${errorMessage}`,
      variant: 'destructive',
    });
  }
}

/**
 * 生成内容哈希值，用于去重
 */
function generateContentHash(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex');
}

/**
 * 并发控制函数 - 限制同时执行的任务数量
 */
async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing: Promise<void>[] = [];
  let completed = 0;

  for (const [index, task] of tasks.entries()) {
    const promise = task()
      .then(result => {
        results[index] = result;
        completed++;
        if (onProgress) {
          onProgress(completed, tasks.length);
        }
      })
      .catch(error => {
        results[index] = error as T;
        completed++;
        if (onProgress) {
          onProgress(completed, tasks.length);
        }
        throw error;
      });

    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex(p => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * 文本分块函数，用于将大文本分成小块
 */
export function chunkText(
  text: string, 
  chunkSize: number = 1000,
  chunkOverlap: number = 200
): string[] {
  const chunks: string[] = [];
  
  // 检查文本是否足够长，需要分块
  if (text.length <= chunkSize) {
    chunks.push(text);
    return chunks;
  }
  
  // 尝试在段落边界进行分块
  const paragraphs = text.split('\n\n');
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    // 如果加上当前段落后超出了块大小，则保存当前块并开始新块
    if (currentChunk.length + paragraph.length + 2 > chunkSize) {
      // 如果当前块非空，保存它
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        // 保留重叠部分到新块
        const lastChunkParts = currentChunk.split('\n\n');
        const overlapLength = Math.min(chunkOverlap, currentChunk.length);
        const overlapParts = [];
        let currentLength = 0;
        
        // 从后向前取段落，直到达到重叠大小
        for (let i = lastChunkParts.length - 1; i >= 0; i--) {
          const part = lastChunkParts[i];
          if (currentLength + part.length + 2 <= overlapLength) {
            overlapParts.unshift(part);
            currentLength += part.length + 2;
          } else {
            break;
          }
        }
        
        currentChunk = overlapParts.join('\n\n');
      }
      
      // 如果单个段落过长，需要强制分割
      if (paragraph.length > chunkSize) {
        // 先尝试按句子分割
        const sentences = paragraph.split(/(?:\.|\?|\!)\s+/);
        let sentenceChunk = '';
        
        for (const sentence of sentences) {
          if (sentenceChunk.length + sentence.length > chunkSize) {
            if (sentenceChunk) {
              chunks.push(sentenceChunk);
              // 保留重叠
              const overlapLength = Math.min(chunkOverlap, sentenceChunk.length);
              sentenceChunk = sentenceChunk.slice(-overlapLength);
            }
          }
          
          sentenceChunk += sentence + ' ';
        }
        
        if (sentenceChunk) {
          currentChunk += sentenceChunk;
        }
      } else {
        currentChunk += paragraph + '\n\n';
      }
    } else {
      currentChunk += paragraph + '\n\n';
    }
  }
  
  // 添加最后一个块
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * 处理单个Markdown文件，计算向量并存储到数据库
 */
export async function processMarkdownFile(
  filePath: string,
  fileContent?: string
): Promise<boolean> {
  try {
    // 检查文件是否在 skills 文件夹下，如果是则跳过处理
    const pathParts = filePath.split('/');
    if (pathParts.some(part => isSkillsFolder(part))) {
      return false;
    }

    const workspace = await getWorkspacePath()
    let content = ''
    if (workspace.isCustom) {
      content = fileContent || await readTextFile(filePath)
    } else {
      const { path, baseDir } = await getFilePathOptions(filePath)
      content = fileContent || await readTextFile(path, { baseDir })
    }
    const store = await Store.load('store.json')
    const chunkSize = await store.get<number>('ragChunkSize');
    const chunkOverlap = await store.get<number>('ragChunkOverlap');
    const chunks = chunkText(content, chunkSize, chunkOverlap);
    // 文件名（不含路径）
    const filename = filePath.split('/').pop() || filePath;

    // 先删除该文件的旧记录
    await deleteVectorDocumentsByFilename(filename);

    // 处理每个文本块
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // 计算嵌入向量
      const embedding = await fetchEmbedding(chunk);

      if (!embedding) {
        console.error(`无法计算文件 ${filename} 第 ${i+1} 块的向量`);
        continue;
      }

      // 保存到数据库
      await upsertVectorDocument({
        filename,
        chunk_id: i,
        content: chunk,
        embedding: JSON.stringify(embedding),
        updated_at: Date.now()
      });
    }

    return true;
  } catch (error) {
    console.error(`处理文件 ${filePath} 失败:`, error);
    return false;
  }
}

/**
 * 获取工作区目录树
 */
async function getWorkspaceFiles(): Promise<DirTree[]> {
  const workspace = await getWorkspacePath();
  
  // 递归处理目录的辅助函数
  async function processDirectory(dirPath: string, useCustomPath: boolean): Promise<DirTree[]> {
    let entries: DirEntry[];
    
    if (useCustomPath) {
      entries = await readDir(dirPath);
    } else {
      entries = await readDir(dirPath, { baseDir: BaseDirectory.AppData });
    }
    
    const result: DirTree[] = [];
    
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue;
      if (!entry.isDirectory && !entry.name.endsWith('.md')) continue;
      
      // 创建DirTree对象
      const item: DirTree = {
        name: entry.name,
        isFile: !entry.isDirectory,
        isDirectory: entry.isDirectory,
        isSymlink: false, // Tauri FS API不直接提供isSymlink
        children: [],
        isLocale: true,
        isEditing: false
      };
      
      // 如果是目录，递归读取子目录
      if (entry.isDirectory) {
        const childPath = await join(dirPath, entry.name);
        // 递归处理子目录
        item.children = await processDirectory(childPath, useCustomPath);
        
        // 设置父级关系
        item.children.forEach(child => {
          child.parent = item;
        });
      }
      
      result.push(item);
    }
    
    return result;
  }
  
  // 开始处理根目录
  const rootPath = workspace.isCustom ? workspace.path : 'article';
  return await processDirectory(rootPath, workspace.isCustom);
}

/**
 * 处理工作区中的所有Markdown文件（支持并行处理）
 */
export async function processAllMarkdownFiles(onProgress?: (current: number, total: number, fileName: string) => void): Promise<{
  total: number;
  success: number;
  failed: number;
  failedFiles: Array<{fileName: string, error: string}>;
}> {
  try {
    // 获取工作区中的所有文件
    const fileTree = await getWorkspaceFiles();

    // 收集所有需要处理的文件
    const filesToProcess: Array<{name: string, path: string}> = [];

    async function collectFiles(tree: DirTree[]): Promise<void> {
      for (const item of tree) {
        if (item.isFile && item.name.endsWith('.md')) {
          const filePath = await getFilePath(item);
          filesToProcess.push({ name: item.name, path: filePath });
        }

        // 递归处理子目录
        if (item.children && item.children.length > 0) {
          await collectFiles(item.children);
        }
      }
    }

    await collectFiles(fileTree);

    // 使用并发控制处理文件（限制并发数为 3）
    const results = await runWithConcurrencyLimit(
      filesToProcess.map(file => async () => {
        try {
          const success = await processMarkdownFile(file.path);
          return { success, fileName: file.name, error: null };
        } catch (error) {
          handleRAGError(error, `处理文件 ${file.name} 失败`, false);
          return { success: false, fileName: file.name, error: String(error) };
        }
      }),
      3, // 并发限制为 3，避免过多 API 调用
      (completed, total) => {
        if (onProgress && completed > 0) {
          const currentFile = filesToProcess[completed - 1]?.name || '';
          onProgress(completed, total, currentFile);
        }
      }
    );

    // 统计结果
    const failedFiles: Array<{fileName: string, error: string}> = [];
    let success = 0;
    let failed = 0;

    for (const result of results) {
      if (result.success) {
        success++;
      } else {
        failed++;
        if (result.error) {
          failedFiles.push({ fileName: result.fileName, error: result.error });
        }
      }
    }

    return {
      total: filesToProcess.length,
      success,
      failed,
      failedFiles
    };
  } catch (error) {
    handleRAGError(error, '处理工作区Markdown文件失败');
    throw error;
  }
}

/**
 * 根据DirTree项获取完整文件路径
 */
async function getFilePath(item: DirTree): Promise<string> {
  const workspace = await getWorkspacePath();
  let path = item.name;
  let parent = item.parent;
  
  // 构建相对路径
  while (parent) {
    path = `${parent.name}/${path}`;
    parent = parent.parent;
  }
  
  // 转换为完整路径
  if (workspace.isCustom) {
    return await join(workspace.path, path);
  } else {
    return path; // 返回相对于AppData/article的路径
  }
}

/**
 * 为fuzzy_search准备的搜索项结构
 */
interface SearchItem {
  id?: string;
  desc?: string;
  title?: string;
  article?: string;
  url?: string;
  search_type?: string;
  score?: number;
  matches?: {
    key: string;
    indices: [number, number][];
    value: string;
  }[];
}

/**
 * fuzzy_search返回的结果结构
 */
interface FuzzySearchResult {
  item: SearchItem;
  refindex: number;
  score: number;
  matches: {
    key: string;
    indices: [number, number][];
    value: string;
  }[];
}

/**
 * 从工作区中收集所有Markdown文件内容，用于模糊搜索
 */
async function collectMarkdownContents(): Promise<SearchItem[]> {
  try {
    // 获取工作区中的所有文件
    const fileTree = await getWorkspaceFiles();
    const items: SearchItem[] = [];
    
    // 递归处理文件树
    async function processTree(tree: DirTree[]): Promise<void> {
      for (const item of tree) {
        if (item.isFile && item.name.endsWith('.md')) {
          // 获取完整路径
          const filePath = await getFilePath(item);
          
          try {
            // 读取文件内容
            let content = '';
            const workspace = await getWorkspacePath();
            if (workspace.isCustom) {
              content = await readTextFile(filePath);
            } else {
              const { path, baseDir } = await getFilePathOptions(filePath);
              content = await readTextFile(path, { baseDir });
            }
            
            // 创建搜索项
            items.push({
              id: filePath,
              title: item.name,
              article: content,
              search_type: 'markdown'
            });
          } catch (error) {
            console.error(`读取文件 ${filePath} 内容失败:`, error);
          }
        }
        
        // 递归处理子目录
        if (item.children && item.children.length > 0) {
          await processTree(item.children);
        }
      }
    }
    
    await processTree(fileTree);
    return items;
  } catch (error) {
    console.error('收集Markdown内容失败:', error);
    return [];
  }
}

/**
 * 关键词及其权重类型定义
 */
export interface Keyword {
  text: string;
  weight: number;
}

/**
 * 根据关键词数组获取相关上下文
 * @param keywords 关键词数组，每个元素包含关键词文本和权重
 * @returns 包含上下文文本和引用文件名的对象
 */
export async function getContextForQuery(keywords: Keyword[]): Promise<{ context: string; sources: string[] }> {
  try {
    const store = await Store.load('store.json');
    const resultCount = await store.get<number>('ragResultCount') || 5;
    const similarityThreshold = await store.get<number>('ragSimilarityThreshold') || 0.7;
    // 存储所有相关上下文的结果集
    const allContexts: { filename: string, content: string, score: number, keyword?: string, type?: string }[] = [];
    
    // 如果没有关键词，返回空结果
    if (!keywords || keywords.length === 0) {
      return { context: '', sources: [] };
    }
    
    // 将关键词按权重排序，优先考虑权重高的关键词
    const sortedKeywords = [...keywords].sort((a, b) => b.weight - a.weight);
    
    // 1. 使用逐个关键词进行模糊搜索找到相关文件内容
    try {
      // 收集所有Markdown文件内容
      const items = await collectMarkdownContents();
      if (items.length > 0) {
        // 为每个关键词单独进行搜索
        for (const keyword of sortedKeywords) {
          // 对每个关键词调用Rust的fuzzy_search函数
          const fuzzyResults: FuzzySearchResult[] = await invoke('fuzzy_search', {
            items,
            query: keyword.text,  // 单独使用每个关键词
            keys: ['title', 'article'],
            threshold: 0.3, // 模糊搜索阈值
            includeScore: true,
            includeMatches: true
          });
          
          // 处理模糊搜索结果
          for (const result of fuzzyResults) {
            if (result.score > 0) {
              const item = result.item;
              // 提取匹配的文本片段作为上下文
              const articleMatches = result.matches.filter(m => m.key === 'article');
              if (articleMatches.length > 0) {
                // 使用匹配部分的上下文（周围大约500个字符）
                const match = articleMatches[0];
                const content = match.value;
                
                // 找到第一个匹配位置的索引
                let startIdx = 0;
                let endIdx = content.length;
                if (match.indices.length > 0) {
                  const firstMatch = match.indices[0];
                  startIdx = Math.max(0, firstMatch[0] - 250);
                  endIdx = Math.min(content.length, firstMatch[1] + 250);
                }
                
                // 使用当前关键词的权重作为得分因子
                const finalScore = result.score * keyword.weight;
                
                const contextSnippet = content.substring(startIdx, endIdx);
                
                allContexts.push({
                  filename: item.title || '未命名文件',
                  content: contextSnippet,
                  score: finalScore,
                  keyword: keyword.text,  // 记录匹配的关键词
                  type: 'fuzzy'
                });
              }
            }
          }
        }
      }
    } catch (error) {
      handleRAGError(error, '模糊搜索失败', false);
    }

    // 2. 使用向量搜索找到相关文档
    try {
      // 为每个关键词生成向量并执行查询
      for (const keyword of sortedKeywords) {
        // 计算查询文本的向量
        const queryEmbedding = await fetchEmbedding(keyword.text);
        if (queryEmbedding) {
          // 查询最相关的文档
          let similarDocs = await getSimilarDocuments(queryEmbedding, resultCount, similarityThreshold);

          if (similarDocs.length > 0) {
            // 如果配置了重排序模型，使用它进一步优化结果
            similarDocs = await rerankDocuments(keyword.text, similarDocs);

            // 添加到结果集，考虑关键词权重
            for (const doc of similarDocs) {
              allContexts.push({
                filename: doc.filename,
                content: doc.content,
                score: (doc.similarity || 0) * keyword.weight, // 用相似度乘以权重作为分数
                keyword: keyword.text,  // 记录匹配的关键词
                type: 'vector'
              });
            }
          }
        }
      }
    } catch (error) {
      handleRAGError(error, '向量搜索失败', false);
    }

    // 如果没有找到任何相关上下文，返回空结果
    if (allContexts.length === 0) {
      return { context: '', sources: [] };
    }

    // 改进的去重逻辑：使用哈希 + 内容相似度去重
    const uniqueContexts: typeof allContexts = [];
    const seenHashes = new Set<string>();

    // 第一阶段：使用精确哈希去重完全相同的内容
    for (const ctx of allContexts) {
      const contentHash = generateContentHash(ctx.content);
      const hashWithFile = `${ctx.filename}-${contentHash}`;

      if (!seenHashes.has(hashWithFile)) {
        seenHashes.add(hashWithFile);
        uniqueContexts.push(ctx);
      } else {
        // 如果哈希已存在，检查是否有更高的分数，如果有则更新
        const existingIndex = uniqueContexts.findIndex(
          existing => {
            const existingHash = generateContentHash(existing.content);
            return existing.filename === ctx.filename && existingHash === contentHash;
          }
        );
        if (existingIndex >= 0 && ctx.score > uniqueContexts[existingIndex].score) {
          uniqueContexts[existingIndex] = ctx;
        }
      }
    }

    // 第二阶段：对相似内容进行合并（使用余弦相似度判断）
    // 这里我们简化处理，只合并同一文件中高度重叠的内容
    const finalUniqueContexts: typeof allContexts = [];
    const mergedIndices = new Set<number>();

    for (let i = 0; i < uniqueContexts.length; i++) {
      if (mergedIndices.has(i)) continue;

      const current = uniqueContexts[i];
      let bestScore = current.score;
      let bestContent = current.content;
      // eslint-disable-next-line prefer-const
      let mergedKeywords = [current.keyword];

      // 查找同一文件中高度重叠的内容
      for (let j = i + 1; j < uniqueContexts.length; j++) {
        if (mergedIndices.has(j)) continue;

        const other = uniqueContexts[j];
        if (other.filename !== current.filename) continue;

        // 计算内容重叠度
        const overlap = calculateContentOverlap(current.content, other.content);

        // 如果重叠度超过 70%，认为是重复内容，合并它们
        if (overlap > 0.7) {
          mergedIndices.add(j);
          // 保留分数更高的
          if (other.score > bestScore) {
            bestScore = other.score;
            bestContent = other.content;
          }
          if (other.keyword && !mergedKeywords.includes(other.keyword)) {
            mergedKeywords.push(other.keyword);
          }
        }
      }

      finalUniqueContexts.push({
        ...current,
        content: bestContent,
        score: bestScore,
        keyword: mergedKeywords.join(', ')
      });
    }

    // 对所有上下文按相关性得分排序
    finalUniqueContexts.sort((a, b) => b.score - a.score);

    // 限制结果数量
    const finalContexts = finalUniqueContexts.slice(0, resultCount);

    // 提取唯一的文件名
    const sources = Array.from(new Set(finalContexts.map(ctx => ctx.filename)));

    // 构建最终的上下文字符串
    const context = finalContexts.map(ctx => {
      return `文件：${ctx.filename}
${ctx.content}
`;
    }).join('\n---\n\n');

    return { context, sources };
  } catch (error) {
    handleRAGError(error, '获取查询上下文失败', false);
    return { context: '', sources: [] };
  }
}

/**
 * 计算两个文本的重叠度（基于字符级的最长公共子序列简化版本）
 */
function calculateContentOverlap(content1: string, content2: string): number {
  const normalized1 = content1.trim().toLowerCase();
  const normalized2 = content2.trim().toLowerCase();

  // 如果任一内容为空，返回 0
  if (!normalized1 || !normalized2) return 0;

  // 简化的重叠度计算：计算共同字符的比例
  const set1 = new Set(normalized1.split(''));
  const set2 = new Set(normalized2.split(''));

  const intersection = new Set([...set1].filter(char => set2.has(char)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 0;

  // Jaccard 相似度
  return intersection.size / union.size;
}

/**
 * 当文件被更新时处理，更新向量数据库
 */
export async function handleFileUpdate(filename: string, content: string): Promise<void> {
  if (!filename.endsWith('.md')) return;

  try {
    await processMarkdownFile(filename, content);
  } catch (error) {
    handleRAGError(error, `更新文件 ${filename} 的向量失败`, false);
  }
}

/**
 * 检查是否有嵌入模型可用
 */
export async function checkEmbeddingModelAvailable(): Promise<boolean> {
  try {
    // 尝试计算一个简单文本的向量
    const embedding = await fetchEmbedding('测试嵌入模型');
    return !!embedding;
  } catch (error) {
    handleRAGError(error, '嵌入模型检查失败', false);
    return false;
  }
}

/**
 * 显示向量处理进度的toast
 */
export function showVectorProcessingToast(message: string) {
  toast({
    title: '向量数据库更新',
    description: message,
  });
}

/**
 * 从指定文件夹中收集Markdown文件内容
 */
async function collectMarkdownContentsInFolder(folderPath: string): Promise<SearchItem[]> {
  try {
    const workspace = await getWorkspacePath();
    const items: SearchItem[] = [];

    // 构建文件夹完整路径
    let fullFolderPath: string;
    if (workspace.isCustom) {
      fullFolderPath = await join(workspace.path, folderPath);
    } else {
      fullFolderPath = folderPath;
    }

    // 递归读取文件夹内容
    async function processTree(dirPath: string, relativePath: string): Promise<void> {
      let currentEntries: DirEntry[];

      if (workspace.isCustom) {
        currentEntries = await readDir(dirPath);
      } else {
        const { path, baseDir } = await getFilePathOptions(relativePath);
        currentEntries = await readDir(path, { baseDir });
      }

      for (const entry of currentEntries) {
        if (entry.name.startsWith('.')) continue;

        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          const entryFullPath = workspace.isCustom
            ? await join(dirPath, entry.name)
            : entryRelativePath;
          await processTree(entryFullPath, entryRelativePath);
        } else if (entry.name.endsWith('.md')) {
          // 读取文件内容并添加到 items
          try {
            let content = '';
            const entryFullPath = workspace.isCustom
              ? await join(dirPath, entry.name)
              : entryRelativePath;

            if (workspace.isCustom) {
              content = await readTextFile(entryFullPath);
            } else {
              const { path, baseDir } = await getFilePathOptions(entryRelativePath);
              content = await readTextFile(path, { baseDir });
            }

            items.push({
              id: entryRelativePath,
              title: entry.name,
              article: content,
              search_type: 'markdown'
            });
          } catch (error) {
            console.error(`读取文件 ${entryRelativePath} 失败:`, error);
          }
        }
      }
    }

    await processTree(fullFolderPath, folderPath);
    return items;
  } catch (error) {
    console.error('收集文件夹Markdown内容失败:', error);
    return [];
  }
}

/**
 * 在指定文件夹范围内获取相关上下文
 * @param keywords 关键词数组
 * @param folderPath 文件夹相对路径
 * @returns 包含上下文文本和引用文件名的对象
 */
export async function getContextForQueryInFolder(
  keywords: Keyword[],
  folderPath: string
): Promise<{ context: string; sources: string[] }> {
  try {
    const store = await Store.load('store.json');
    const resultCount = await store.get<number>('ragResultCount') || 5;
    const similarityThreshold = await store.get<number>('ragSimilarityThreshold') || 0.7;
    const allContexts: { filename: string, content: string, score: number, keyword?: string, type?: string }[] = [];

    if (!keywords || keywords.length === 0) {
      return { context: '', sources: [] };
    }

    const sortedKeywords = [...keywords].sort((a, b) => b.weight - a.weight);

    // 收集文件夹范围内的文件
    const items = await collectMarkdownContentsInFolder(folderPath);
    const folderFilenames = new Set(items.map(item => item.title || ''));

    // 1. 模糊搜索（限定到文件夹）
    try {
      if (items.length > 0) {
        for (const keyword of sortedKeywords) {
          const fuzzyResults: FuzzySearchResult[] = await invoke('fuzzy_search', {
            items,
            query: keyword.text,
            keys: ['title', 'article'],
            threshold: 0.3,
            includeScore: true,
            includeMatches: true
          });

          for (const result of fuzzyResults) {
            if (result.score > 0) {
              const item = result.item;
              const articleMatches = result.matches.filter(m => m.key === 'article');
              if (articleMatches.length > 0) {
                const match = articleMatches[0];
                const content = match.value;

                let startIdx = 0;
                let endIdx = content.length;
                if (match.indices.length > 0) {
                  const firstMatch = match.indices[0];
                  startIdx = Math.max(0, firstMatch[0] - 250);
                  endIdx = Math.min(content.length, firstMatch[1] + 250);
                }

                const finalScore = result.score * keyword.weight;
                const contextSnippet = content.substring(startIdx, endIdx);

                allContexts.push({
                  filename: item.title || '未命名文件',
                  content: contextSnippet,
                  score: finalScore,
                  keyword: keyword.text,
                  type: 'fuzzy'
                });
              }
            }
          }
        }
      }
    } catch (error) {
      handleRAGError(error, '模糊搜索失败', false);
    }

    // 2. 向量搜索 - 过滤到文件夹范围
    try {
      for (const keyword of sortedKeywords) {
        const queryEmbedding = await fetchEmbedding(keyword.text);
        if (queryEmbedding) {
          let similarDocs = await getSimilarDocuments(queryEmbedding, resultCount, similarityThreshold);
          // 过滤：只保留文件夹内的文件
          similarDocs = similarDocs.filter(doc => folderFilenames.has(doc.filename));

          if (similarDocs.length > 0) {
            similarDocs = await rerankDocuments(keyword.text, similarDocs);

            for (const doc of similarDocs) {
              allContexts.push({
                filename: doc.filename,
                content: doc.content,
                score: (doc.similarity || 0) * keyword.weight,
                keyword: keyword.text,
                type: 'vector'
              });
            }
          }
        }
      }
    } catch (error) {
      handleRAGError(error, '向量搜索失败', false);
    }

    // 去重和排序逻辑（与 getContextForQuery 相同）
    if (allContexts.length === 0) {
      return { context: '', sources: [] };
    }

    // 第一阶段：使用精确哈希去重完全相同的内容
    const uniqueContexts: typeof allContexts = [];
    const seenHashes = new Set<string>();

    for (const ctx of allContexts) {
      const contentHash = generateContentHash(ctx.content);
      const hashWithFile = `${ctx.filename}-${contentHash}`;

      if (!seenHashes.has(hashWithFile)) {
        seenHashes.add(hashWithFile);
        uniqueContexts.push(ctx);
      } else {
        const existingIndex = uniqueContexts.findIndex(
          existing => {
            const existingHash = generateContentHash(existing.content);
            return existing.filename === ctx.filename && existingHash === contentHash;
          }
        );
        if (existingIndex >= 0 && ctx.score > uniqueContexts[existingIndex].score) {
          uniqueContexts[existingIndex] = ctx;
        }
      }
    }

    // 第二阶段：对相似内容进行合并
    const finalUniqueContexts: typeof allContexts = [];
    const mergedIndices = new Set<number>();

    for (let i = 0; i < uniqueContexts.length; i++) {
      if (mergedIndices.has(i)) continue;

      const current = uniqueContexts[i];
      let bestScore = current.score;
      let bestContent = current.content;
      // eslint-disable-next-line prefer-const
      let mergedKeywords = [current.keyword];

      for (let j = i + 1; j < uniqueContexts.length; j++) {
        if (mergedIndices.has(j)) continue;

        const other = uniqueContexts[j];
        if (other.filename !== current.filename) continue;

        const overlap = calculateContentOverlap(current.content, other.content);

        if (overlap > 0.7) {
          mergedIndices.add(j);
          if (other.score > bestScore) {
            bestScore = other.score;
            bestContent = other.content;
          }
          if (other.keyword && !mergedKeywords.includes(other.keyword)) {
            mergedKeywords.push(other.keyword);
          }
        }
      }

      finalUniqueContexts.push({
        ...current,
        content: bestContent,
        score: bestScore,
        keyword: mergedKeywords.join(', ')
      });
    }

    finalUniqueContexts.sort((a, b) => b.score - a.score);
    const finalContexts = finalUniqueContexts.slice(0, resultCount);
    const sources = Array.from(new Set(finalContexts.map(ctx => ctx.filename)));

    const context = finalContexts.map(ctx => {
      return `文件：${ctx.filename}
${ctx.content}
`;
    }).join('\n---\n\n');

    return { context, sources };
  } catch (error) {
    handleRAGError(error, '获取文件夹查询上下文失败', false);
    return { context: '', sources: [] };
  }
}
