import { readTextFile, readDir, BaseDirectory, DirEntry } from "@tauri-apps/plugin-fs";
import { fetchEmbedding, rerankDocuments } from "./ai";
import {
  upsertVectorDocument,
  deleteVectorDocumentsByFilename,
  getSimilarDocuments,
  getVectorDocumentsByFilename,
  initVectorDb,
  VectorDocument
} from "@/db/vector";
import { invoke } from "@tauri-apps/api/core";
import { BM25Document, initBM25Index, getBM25Index } from "./bm25";

// 重新导出initVectorDb，使其可在其他模块中导入
export { initVectorDb };
import { getFilePathOptions, getWorkspacePath } from "./workspace";
import { DirTree } from "@/stores/article";
import { toast } from "@/hooks/use-toast";
import { join } from "@tauri-apps/api/path";
import { Store } from "@tauri-apps/plugin-store";
import { createHash } from 'crypto';
import { isSkillsFolder } from './skills/utils';
import { getVectorDocumentKey } from './vector-document-key';

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
 * 初始化 BM25 索引
 * 从工作区的 Markdown 文件构建 BM25 索引
 */
export async function initBM25Search(): Promise<void> {
  try {
    // 收集所有 Markdown 文件内容
    const items = await collectMarkdownContents();

    // 转换为 BM25Document 格式
    const documents: BM25Document[] = items.map(item => ({
      id: item.id || item.title || 'unknown',
      content: item.title + '\n\n' + item.article // 包含标题和内容
    }));

    // 初始化索引
    initBM25Index(documents);
  } catch (error) {
    console.error('初始化 BM25 索引失败:', error);
  }
}

/**
 * 常用虚词/停用词列表
 * 这些词在搜索时应该被过滤或降权，因为它们在文档中出现频率过高
 */
const STOP_WORDS = new Set([
  // 中文虚词
  '的', '了', '是', '在', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
  '好', '自己', '这', '那', '里', '就是', '为', '与', '之', '用', '可以',
  '但', '而', '或', '及', '等', '对', '把', '被', '让', '给', '从', '向',

  // 英文停用词
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
]);

/**
 * 同义词词典
 * 用于查询转换优化，生成查询变体
 */
const SYNONYM_DICT: Record<string, string[]> = {
  // AI/技术术语
  'ai': ['人工智能', 'artificial intelligence', '机器学习', 'ml'],
  'llm': ['大语言模型', 'large language model', '语言模型'],
  'rag': ['检索增强生成', 'retrieval augmented generation'],
  'agent': ['智能体', '代理', '助手'],
  'embedding': ['嵌入', '向量', '向量化'],
  'vector': ['向量', '矢量'],
  'prompt': ['提示词', '提示', '指令'],

  // 通用同义词
  '如何': ['怎么', '怎样', '如何做', '方法'],
  '怎么': ['如何', '怎样', '怎么操作'],
  '怎样': ['如何', '怎么', '怎样做'],
  '是什么': ['定义', '解释', '含义', '概念'],
  '为什么': ['原因', '为何', '理由'],
  '做什么': ['干什么', '做什么用', '作用'],
  '使用': ['应用', '运用', '采用', '利用'],
  '创建': ['建立', '新建', '生成', '构建'],
  '获取': ['得到', '获得', '取得'],
  '设置': ['配置', '设定', '修改'],
  '问题': ['疑问', '困难', '难题'],
  '解决': ['处理', '修复', '解答'],
};

/**
 * 检查关键词是否为停用词
 */
function isStopWord(keyword: string): boolean {
  const cleanKeyword = keyword.trim().toLowerCase();
  return STOP_WORDS.has(cleanKeyword);
}

/**
 * 查询转换接口
 */
interface QueryVariant {
  original: string;  // 原始查询
  transformed: string; // 转换后的查询
  source: 'original' | 'synonym';
}

/**
 * 基于同义词词典扩展查询
 * @param query 原始查询
 * @param maxVariants 最大变体数量
 * @returns 查询变体列表
 */
function expandWithSynonyms(query: string, maxVariants: number = 3): QueryVariant[] {
  const variants: QueryVariant[] = [
    { original: query, transformed: query, source: 'original' }
  ];

  // 检查查询中的每个词是否在同义词词典中
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);

  for (const word of words) {
    // 移除标点符号
    const cleanWord = word.replace(/[^\w\u4e00-\u9fa5]/g, '');

    if (SYNONYM_DICT[cleanWord]) {
      const synonyms = SYNONYM_DICT[cleanWord];

      // 为每个同义词生成变体
      for (const synonym of synonyms) {
        if (variants.length >= maxVariants) break;

        const transformed = queryLower.replace(new RegExp(cleanWord, 'gi'), synonym);

        // 避免重复
        if (!variants.some(v => v.transformed === transformed)) {
          variants.push({
            original: query,
            transformed,
            source: 'synonym'
          });
        }
      }
    }

    if (variants.length >= maxVariants) break;
  }

  return variants;
}

/**
 * 转换查询（生成多个变体）
 * @param keywords 原始关键词列表
 * @param enableExpansion 是否启用查询扩展
 * @param maxVariants 每个关键词的最大变体数量
 * @returns 扩展后的关键词列表
 */
function transformQueries(
  keywords: Keyword[],
  enableExpansion: boolean,
  maxVariants: number
): Keyword[] {
  if (!enableExpansion) {
    return keywords;
  }

  const expandedKeywords: Keyword[] = [];

  for (const keyword of keywords) {
    // 生成查询变体
    const variants = expandWithSynonyms(keyword.text, maxVariants);

    // 将变体添加到关键词列表
    for (const variant of variants) {
      // 避免重复
      if (!expandedKeywords.some(k => k.text === variant.transformed)) {
        expandedKeywords.push({
          text: variant.transformed,
          weight: keyword.weight // 保持原始权重
        });
      }
    }
  }

  return expandedKeywords;
}

/**
 * 扩展检索结果的句子窗口
 * 为每个匹配的 chunk 获取同一文件中相邻的 chunk，提供更完整的上下文
 *
 * @param results 原始检索结果
 * @param windowSize 窗口大小（前后各取 N 个 chunk）
 * @returns 扩展后的检索结果
 */
async function expandWithSentenceWindow(
  results: Array<{ id: number; filename: string; content: string; similarity?: number }>,
  windowSize: number = 2
): Promise<Array<{ id: number; filename: string; content: string; similarity?: number }>> {
  // 按文件分组结果
  const resultsByFile = new Map<string, typeof results>();
  for (const result of results) {
    if (!resultsByFile.has(result.filename)) {
      resultsByFile.set(result.filename, []);
    }
    resultsByFile.get(result.filename)!.push(result);
  }

  const expandedResults: typeof results = [];

  // 对每个文件的结果进行扩展
  for (const [filename, fileResults] of resultsByFile.entries()) {
    try {
      // 获取该文件的所有向量文档（按 chunk_id 排序）
      const allChunks = await getVectorDocumentsByFilename(filename);

      // 创建 chunk_id 到文档的映射
      const chunkMap = new Map<number, VectorDocument>();
      for (const chunk of allChunks) {
        chunkMap.set(chunk.chunk_id, chunk);
      }

      // 对每个结果进行窗口扩展
      for (const result of fileResults) {
        // 找到该结果对应的 chunk_id
        let centerChunkId: number | undefined;

        // 通过内容匹配找到 chunk_id
        for (const [chunkId, chunk] of chunkMap.entries()) {
          if (chunk.content === result.content) {
            centerChunkId = chunkId;
            break;
          }
        }

        if (centerChunkId === undefined) {
          // 如果找不到对应的 chunk，直接添加原结果
          expandedResults.push(result);
          continue;
        }

        // 获取窗口内的相邻 chunk
        const windowContents: string[] = [];
        for (let i = centerChunkId - windowSize; i <= centerChunkId + windowSize; i++) {
          const chunk = chunkMap.get(i);
          if (chunk) {
            windowContents.push(chunk.content);
          }
        }

        // 合并窗口内容
        const expandedContent = windowContents.join('\n\n---\n\n');

        expandedResults.push({
          ...result,
          content: expandedContent
        });
      }
    } catch (error) {
      console.error(`扩展文件 ${filename} 的句子窗口失败:`, error);
      // 失败时保留原结果
      expandedResults.push(...fileResults);
    }
  }

  return expandedResults;
}

/**
 * BM25 搜索辅助函数
 * @param query 查询文本
 * @param limit 返回结果数量
 * @returns BM25 检索结果
 */
async function searchWithBM25(query: string, limit: number = 10): Promise<Array<{id: string, score: number}>> {
  const index = getBM25Index();
  if (!index) {
    console.warn('BM25 索引未初始化，跳过 BM25 搜索');
    return [];
  }

  return index.search(query, limit);
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
    // 如果内容为空或只有空白字符，跳过处理
    if (!content || content.trim().length === 0) {
      return false;
    }

    const store = await Store.load('store.json')
    const chunkSize = await store.get<number>('ragChunkSize');
    const chunkOverlap = await store.get<number>('ragChunkOverlap');
    const chunks = chunkText(content, chunkSize, chunkOverlap).filter(chunk => chunk.trim().length > 0);
    // 如果没有有效的文本块，跳过处理
    if (chunks.length === 0) {
      return false;
    }
    const vectorDocumentKey = getVectorDocumentKey(filePath);
    const legacyFilename = filePath.split('/').pop() || filePath;

    // 先删除该文件的旧记录
    await deleteVectorDocumentsByFilename(vectorDocumentKey);
    if (legacyFilename !== vectorDocumentKey) {
      await deleteVectorDocumentsByFilename(legacyFilename);
    }

    // 处理每个文本块
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // 计算嵌入向量
      const embedding = await fetchEmbedding(chunk);

      if (!embedding) {
        console.error(`无法计算文件 ${vectorDocumentKey} 第 ${i+1} 块的向量`);
        continue;
      }

      // 保存到数据库
      await upsertVectorDocument({
        filename: vectorDocumentKey,
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
 * 检索结果类型定义
 */
interface SearchResult {
  filename: string;
  filepath: string;
  content: string;
  rawScore: number;      // 原始分数（未归一化）
  normalizedScore: number; // 归一化后的分数
  keyword?: string;
  type: 'fuzzy' | 'vector' | 'bm25';
}

/**
 * 关键词及其权重类型定义
 */
export interface Keyword {
  text: string;
  weight: number;
}

/**
 * RAG 来源详情类型定义
 */
export interface RagSource {
  filepath: string;  // 文件的相对路径
  filename: string;  // 文件名
  content: string;   // 引用的文本片段
}

/**
 * 根据关键词数组获取相关上下文
 * @param keywords 关键词数组，每个元素包含关键词文本和权重
 * @returns 包含上下文文本和引用文件名的对象
 */
export async function getContextForQuery(keywords: Keyword[]): Promise<{
  context: string;
  sources: string[];
  sourceDetails: RagSource[];
}> {
  try {
    const store = await Store.load('store.json');
    const resultCount = await store.get<number>('ragResultCount') || 5;
    const similarityThreshold = await store.get<number>('ragSimilarityThreshold') || 0.25;

    // 读取权重配置（新增配置项）
    const fuzzyWeight = await store.get<number>('ragFuzzyWeight') ?? 0.2;
    const vectorWeight = await store.get<number>('ragVectorWeight') ?? 0.7;
    const bm25Weight = await store.get<number>('ragBm25Weight') ?? 0.1;

    const weights = {
      fuzzyWeight,
      vectorWeight,
      bm25Weight
    };

    // 存储所有检索结果（使用新的 SearchResult 类型）
    const allResults: SearchResult[] = [];

    // 如果没有关键词，返回空结果
    if (!keywords || keywords.length === 0) {
      return { context: '', sources: [], sourceDetails: [] };
    }

    // 读取查询扩展配置
    const enableQueryExpansion = await store.get<boolean>('ragEnableQueryExpansion') ?? true;
    const maxQueryVariations = await store.get<number>('ragMaxQueryVariations') ?? 3;

    // 应用查询转换（生成同义词变体）
    const expandedKeywords = transformQueries(keywords, enableQueryExpansion, maxQueryVariations);

    // 将关键词按权重排序，优先考虑权重高的关键词
    const sortedKeywords = [...expandedKeywords].sort((a, b) => b.weight - a.weight);

    // 1. 使用逐个关键词进行模糊搜索找到相关文件内容
    try {
      // 收集所有Markdown文件内容
      const items = await collectMarkdownContents();
      if (items.length > 0) {
        // 为每个关键词单独进行搜索
        for (const keyword of sortedKeywords) {
          // 跳过停用词的模糊搜索（这些词匹配太多低质量结果）
          if (isStopWord(keyword.text)) {
            continue;
          }

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

                const contextSnippet = content.substring(startIdx, endIdx);

                allResults.push({
                  filename: item.title || '未命名文件',
                  filepath: item.id || '',
                  content: contextSnippet,
                  rawScore: result.score * keyword.weight, // 保留原始分数
                  normalizedScore: 0, // 稍后计算
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

    // 2. 使用向量搜索找到相关文档
    try {
      // 读取窗口大小配置
      const windowSize = await store.get<number>('ragWindowSize') ?? 2;

      // 为每个关键词生成向量并执行查询
      for (const keyword of sortedKeywords) {
        // 计算查询文本的向量
        const queryEmbedding = await fetchEmbedding(keyword.text);

        if (!queryEmbedding) {
          continue;
        }

        // 查询最相关的文档
        let similarDocs = await getSimilarDocuments(queryEmbedding, resultCount * 2, similarityThreshold);

        if (similarDocs.length > 0) {
          // 如果配置了重排序模型，使用它进一步优化结果
          similarDocs = await rerankDocuments(keyword.text, similarDocs);

          // 应用句子窗口扩展（获取更多候选结果用于窗口扩展）
          const expandedDocs = await expandWithSentenceWindow(similarDocs, windowSize);

          // 添加到结果集
          for (const doc of expandedDocs) {
            allResults.push({
              filename: doc.filename,
              filepath: doc.filename,
              content: doc.content,
              rawScore: (doc.similarity || 0) * keyword.weight, // 保留原始分数
              normalizedScore: 0, // 稍后计算
              keyword: keyword.text,
              type: 'vector'
            });
          }
        }
      }
    } catch (error) {
      handleRAGError(error, '向量搜索失败', false);
    }

    // 3. 使用 BM25 搜索找到相关文档
    try {
      // 收集所有 Markdown 文件内容用于 BM25 匹配后获取上下文
      const items = await collectMarkdownContents();
      const itemsMap = new Map(items.map(item => [item.id || item.title || '', item]));

      // 为每个关键词执行 BM25 搜索
      for (const keyword of sortedKeywords) {
        const bm25Results = await searchWithBM25(keyword.text, resultCount);

        for (const result of bm25Results) {
          const item = itemsMap.get(result.id);
          if (!item || !item.article) continue;

          // 从匹配项中提取上下文（尝试找到关键词周围的内容）
          const articleLower = item.article.toLowerCase();
          const keywordLower = keyword.text.toLowerCase();
          const keywordIndex = articleLower.indexOf(keywordLower);

          let startIdx = 0;
          let endIdx = item.article.length;

          if (keywordIndex >= 0) {
            startIdx = Math.max(0, keywordIndex - 250);
            endIdx = Math.min(item.article.length, keywordIndex + keyword.text.length + 250);
          } else {
            // 如果没找到精确匹配，取中间部分
            const mid = Math.floor(item.article.length / 2);
            startIdx = Math.max(0, mid - 250);
            endIdx = Math.min(item.article.length, mid + 250);
          }

          const contextSnippet = item.article.substring(startIdx, endIdx);

          allResults.push({
            filename: item.title || '未命名文件',
            filepath: item.id || '',
            content: contextSnippet,
            rawScore: result.score * keyword.weight,
            normalizedScore: 0,
            keyword: keyword.text,
            type: 'bm25'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, 'BM25 搜索失败', false);
    }

    // 如果没有找到任何相关上下文，返回空结果
    if (allResults.length === 0) {
      return { context: '', sources: [], sourceDetails: [] };
    }

    // 3. 按文档合并结果，使用归一化和混合权重
    const mergedResults = mergeResultsByDocument(allResults, weights);

    // 4. 对相似内容进行合并（使用内容重叠度判断）
    const finalUniqueResults: SearchResult[] = [];
    const mergedIndices = new Set<number>();

    for (let i = 0; i < mergedResults.length; i++) {
      if (mergedIndices.has(i)) continue;

      const current = mergedResults[i];
      let bestScore = current.normalizedScore;
      let bestContent = current.content;
      const mergedKeywords: string[] = [];

      if (current.keyword) {
        mergedKeywords.push(current.keyword);
      }

      // 查找同一文件中高度重叠的内容
      for (let j = i + 1; j < mergedResults.length; j++) {
        if (mergedIndices.has(j)) continue;

        const other = mergedResults[j];
        if (other.filename !== current.filename) continue;

        // 计算内容重叠度
        const overlap = calculateContentOverlap(current.content, other.content);

        // 如果重叠度超过 70%，认为是重复内容，合并它们
        if (overlap > 0.7) {
          mergedIndices.add(j);
          // 保留分数更高的
          if (other.normalizedScore > bestScore) {
            bestScore = other.normalizedScore;
            bestContent = other.content;
          }
          if (other.keyword && !mergedKeywords.includes(other.keyword)) {
            mergedKeywords.push(other.keyword);
          }
        }
      }

      finalUniqueResults.push({
        ...current,
        content: bestContent,
        normalizedScore: bestScore,
        keyword: mergedKeywords.join(', ')
      });
    }

    // 对所有上下文按相关性得分排序
    finalUniqueResults.sort((a: SearchResult, b: SearchResult) => b.normalizedScore - a.normalizedScore);

    // 限制结果数量
    const finalResults = finalUniqueResults.slice(0, resultCount);

    // 提取唯一的文件名
    const sources = Array.from(new Set(finalResults.map((ctx: SearchResult) => ctx.filename)));

    // 构建 sourceDetails（去重，每个文件只保留最相关的一个片段）
    const sourceDetailsMap = new Map<string, RagSource>();
    for (const ctx of finalResults) {
      if (!sourceDetailsMap.has(ctx.filename)) {
        sourceDetailsMap.set(ctx.filename, {
          filepath: ctx.filepath,
          filename: ctx.filename,
          content: ctx.content
        });
      }
    }
    const sourceDetails = Array.from(sourceDetailsMap.values());

    // 构建最终的上下文字符串
    const context = finalResults.map((ctx: SearchResult) => {
      return `文件：${ctx.filename}
${ctx.content}
`;
    }).join('\n---\n\n');

    return { context, sources, sourceDetails };
  } catch (error) {
    handleRAGError(error, '获取查询上下文失败', false);
    return { context: '', sources: [], sourceDetails: [] };
  }
}

/**
 * 分数归一化配置
 */
interface NormalizationConfig {
  minScore: number;
  maxScore: number;
}

/**
 * 归一化分数到 [0, 1] 区间
 * @param score 原始分数
 * @param type 分数类型（不同类型使用不同的归一化策略）
 * @param allScores 同类型所有分数的数组（用于 min-max 归一化）
 */
function normalizeScore(
  score: number,
  type: 'fuzzy' | 'vector' | 'bm25',
  allScores: number[] = []
): number {
  // 如果提供了该类型的所有分数，使用 min-max 归一化
  if (allScores.length > 1) {
    const min = Math.min(...allScores);
    const max = Math.max(...allScores);
    if (max - min < 0.0001) {
      // 所有分数几乎相同，返回 0.5
      return 0.5;
    }
    return (score - min) / (max - min);
  }

  // 否则使用预定义的范围进行归一化
  const configs: Record<string, NormalizationConfig> = {
    // fuzzy_search 分数通常在 [0, 1] 区间
    fuzzy: { minScore: 0, maxScore: 1 },
    // 向量相似度已经在 [0, 1] 区间（余弦相似度）
    vector: { minScore: 0, maxScore: 1 },
    // BM25 分数范围不固定，但通常在 [0, +∞)，使用 Sigmoid 压缩
    bm25: { minScore: 0, maxScore: 10 }
  };

  const config = configs[type] || { minScore: 0, maxScore: 1 };

  if (type === 'bm25') {
    // BM25 使用 Sigmoid 函数压缩到 [0, 1]
    return 1 / (1 + Math.exp(-score / 2));
  }

  // 简单的线性归一化
  const normalized = (score - config.minScore) / (config.maxScore - config.minScore);
  return Math.max(0, Math.min(1, normalized));
}

/**
 * 计算混合分数（支持可配置权重）
 * @param normalizedScores 各类型归一化后的分数
 * @param weights 各类型的权重配置
 */
function calculateHybridScore(
  normalizedScores: {
    fuzzy?: number;
    vector?: number;
    bm25?: number;
  },
  weights: {
    fuzzyWeight: number;
    vectorWeight: number;
    bm25Weight: number;
  }
): number {
  let totalScore = 0;
  let totalWeight = 0;

  if (normalizedScores.fuzzy !== undefined && weights.fuzzyWeight > 0) {
    totalScore += normalizedScores.fuzzy * weights.fuzzyWeight;
    totalWeight += weights.fuzzyWeight;
  }

  if (normalizedScores.vector !== undefined && weights.vectorWeight > 0) {
    totalScore += normalizedScores.vector * weights.vectorWeight;
    totalWeight += weights.vectorWeight;
  }

  if (normalizedScores.bm25 !== undefined && weights.bm25Weight > 0) {
    totalScore += normalizedScores.bm25 * weights.bm25Weight;
    totalWeight += weights.bm25Weight;
  }

  // 如果没有任何有效分数，返回 0
  if (totalWeight === 0) return 0;

  return totalScore / totalWeight;
}

/**
 * 合并相同文档的不同检索结果
 * @param results 所有检索结果
 * @param weights 权重配置
 */
function mergeResultsByDocument(
  results: SearchResult[],
  weights: {
    fuzzyWeight: number;
    vectorWeight: number;
    bm25Weight: number;
  }
): SearchResult[] {
  // 按文档分组
  const docGroups = new Map<string, SearchResult[]>();

  for (const result of results) {
    const key = `${result.filename}-${generateContentHash(result.content)}`;
    if (!docGroups.has(key)) {
      docGroups.set(key, []);
    }
    docGroups.get(key)!.push(result);
  }

  // 对每个文档组，计算混合分数
  const mergedResults: SearchResult[] = [];

  for (const group of docGroups.values()) {
    // 收集各类型的最高分数
    const scoresByType: Record<string, number[]> = { fuzzy: [], vector: [], bm25: [] };

    for (const result of group) {
      if (!scoresByType[result.type]) {
        scoresByType[result.type] = [];
      }
      scoresByType[result.type].push(result.rawScore);
    }

    // 计算归一化分数
    let bestFuzzyScore = 0;
    let bestVectorScore = 0;
    let bestBm25Score = 0;

    if (scoresByType.fuzzy.length > 0) {
      const maxFuzzy = Math.max(...scoresByType.fuzzy);
      bestFuzzyScore = normalizeScore(maxFuzzy, 'fuzzy');
    }

    if (scoresByType.vector.length > 0) {
      const maxVector = Math.max(...scoresByType.vector);
      bestVectorScore = normalizeScore(maxVector, 'vector');
    }

    if (scoresByType.bm25.length > 0) {
      const maxBm25 = Math.max(...scoresByType.bm25);
      bestBm25Score = normalizeScore(maxBm25, 'bm25');
    }

    // 计算混合分数
    const hybridScore = calculateHybridScore(
      {
        fuzzy: bestFuzzyScore || undefined,
        vector: bestVectorScore || undefined,
        bm25: bestBm25Score || undefined
      },
      weights
    );

    // 选择分数最高的结果作为基础
    const bestResult = group.reduce((best, current) =>
      current.rawScore > best.rawScore ? current : best
    );

    mergedResults.push({
      ...bestResult,
      rawScore: hybridScore,
      normalizedScore: hybridScore,
      type: bestResult.type // 保留主要检索类型
    });
  }

  return mergedResults;
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
export async function handleFileUpdate(filePath: string, content: string): Promise<void> {
  if (!filePath.endsWith('.md')) return;

  try {
    await processMarkdownFile(filePath, content);
  } catch (error) {
    handleRAGError(error, `更新文件 ${filePath} 的向量失败`, false);
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
): Promise<{ context: string; sources: string[]; sourceDetails: RagSource[] }> {
  try {
    const store = await Store.load('store.json');
    const resultCount = await store.get<number>('ragResultCount') || 5;
    const similarityThreshold = await store.get<number>('ragSimilarityThreshold') || 0.25;

    // 读取权重配置
    const fuzzyWeight = await store.get<number>('ragFuzzyWeight') ?? 0.2;
    const vectorWeight = await store.get<number>('ragVectorWeight') ?? 0.7;
    const bm25Weight = await store.get<number>('ragBm25Weight') ?? 0.1;

    const weights = {
      fuzzyWeight,
      vectorWeight,
      bm25Weight
    };

    const allResults: SearchResult[] = [];

    if (!keywords || keywords.length === 0) {
      return { context: '', sources: [], sourceDetails: [] };
    }

    // 读取查询扩展配置
    const enableQueryExpansion = await store.get<boolean>('ragEnableQueryExpansion') ?? true;
    const maxQueryVariations = await store.get<number>('ragMaxQueryVariations') ?? 3;

    // 应用查询转换（生成同义词变体）
    const expandedKeywords = transformQueries(keywords, enableQueryExpansion, maxQueryVariations);

    const sortedKeywords = [...expandedKeywords].sort((a, b) => b.weight - a.weight);

    // 收集文件夹范围内的文件
    const items = await collectMarkdownContentsInFolder(folderPath);
    const folderFilenames = new Set(items.map(item => item.title || ''));

    // 1. 模糊搜索（限定到文件夹）
    try {
      if (items.length > 0) {
        for (const keyword of sortedKeywords) {
          // 跳过停用词的模糊搜索
          if (isStopWord(keyword.text)) {
            continue;
          }

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

                const contextSnippet = content.substring(startIdx, endIdx);

                allResults.push({
                  filename: item.title || '未命名文件',
                  filepath: item.id || '',
                  content: contextSnippet,
                  rawScore: result.score * keyword.weight,
                  normalizedScore: 0,
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
      const windowSize = await store.get<number>('ragWindowSize') ?? 2;

      for (const keyword of sortedKeywords) {
        const queryEmbedding = await fetchEmbedding(keyword.text);
        if (queryEmbedding) {
          let similarDocs = await getSimilarDocuments(queryEmbedding, resultCount * 2, similarityThreshold);
          // 过滤：只保留文件夹内的文件
          similarDocs = similarDocs.filter(doc => folderFilenames.has(doc.filename));

          if (similarDocs.length > 0) {
            similarDocs = await rerankDocuments(keyword.text, similarDocs);

            // 应用句子窗口扩展
            const expandedDocs = await expandWithSentenceWindow(similarDocs, windowSize);

            for (const doc of expandedDocs) {
              allResults.push({
                filename: doc.filename,
                filepath: doc.filename,
                content: doc.content,
                rawScore: (doc.similarity || 0) * keyword.weight,
                normalizedScore: 0,
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

    // 3. 使用 BM25 搜索找到相关文档（限定到文件夹范围）
    try {
      const itemsMap = new Map(items.map(item => [item.id || item.title || '', item]));

      for (const keyword of sortedKeywords) {
        const bm25Results = await searchWithBM25(keyword.text, resultCount);

        for (const result of bm25Results) {
          const item = itemsMap.get(result.id);
          if (!item || !item.article) continue;

          // 验证文件在文件夹范围内
          if (!folderFilenames.has(item.title || '')) continue;

          const articleLower = item.article.toLowerCase();
          const keywordLower = keyword.text.toLowerCase();
          const keywordIndex = articleLower.indexOf(keywordLower);

          let startIdx = 0;
          let endIdx = item.article.length;

          if (keywordIndex >= 0) {
            startIdx = Math.max(0, keywordIndex - 250);
            endIdx = Math.min(item.article.length, keywordIndex + keyword.text.length + 250);
          } else {
            const mid = Math.floor(item.article.length / 2);
            startIdx = Math.max(0, mid - 250);
            endIdx = Math.min(item.article.length, mid + 250);
          }

          const contextSnippet = item.article.substring(startIdx, endIdx);

          allResults.push({
            filename: item.title || '未命名文件',
            filepath: item.id || '',
            content: contextSnippet,
            rawScore: result.score * keyword.weight,
            normalizedScore: 0,
            keyword: keyword.text,
            type: 'bm25'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, 'BM25 搜索失败', false);
    }

    // 如果没有找到任何相关上下文，返回空结果
    if (allResults.length === 0) {
      return { context: '', sources: [], sourceDetails: [] };
    }

    // 3. 按文档合并结果，使用归一化和混合权重
    const mergedResults = mergeResultsByDocument(allResults, weights);

    // 4. 对相似内容进行合并
    const finalUniqueResults: SearchResult[] = [];
    const mergedIndices = new Set<number>();

    for (let i = 0; i < mergedResults.length; i++) {
      if (mergedIndices.has(i)) continue;

      const current = mergedResults[i];
      let bestScore = current.normalizedScore;
      let bestContent = current.content;
      const mergedKeywords: string[] = [];

      if (current.keyword) {
        mergedKeywords.push(current.keyword);
      }

      for (let j = i + 1; j < mergedResults.length; j++) {
        if (mergedIndices.has(j)) continue;

        const other = mergedResults[j];
        if (other.filename !== current.filename) continue;

        const overlap = calculateContentOverlap(current.content, other.content);

        if (overlap > 0.7) {
          mergedIndices.add(j);
          if (other.normalizedScore > bestScore) {
            bestScore = other.normalizedScore;
            bestContent = other.content;
          }
          if (other.keyword && !mergedKeywords.includes(other.keyword)) {
            mergedKeywords.push(other.keyword);
          }
        }
      }

      finalUniqueResults.push({
        ...current,
        content: bestContent,
        normalizedScore: bestScore,
        keyword: mergedKeywords.join(', ')
      });
    }

    finalUniqueResults.sort((a: SearchResult, b: SearchResult) => b.normalizedScore - a.normalizedScore);
    const finalResults = finalUniqueResults.slice(0, resultCount);

    const sources = Array.from(new Set(finalResults.map((ctx: SearchResult) => ctx.filename)));

    // 构建 sourceDetails
    const sourceDetailsMap = new Map<string, RagSource>();
    for (const ctx of finalResults) {
      if (!sourceDetailsMap.has(ctx.filename)) {
        sourceDetailsMap.set(ctx.filename, {
          filepath: ctx.filepath,
          filename: ctx.filename,
          content: ctx.content
        })
      }
    }
    const sourceDetails = Array.from(sourceDetailsMap.values())

    const context = finalResults.map((ctx: SearchResult) => {
      return `文件：${ctx.filename}
${ctx.content}
`;
    }).join('\n---\n\n');

    return { context, sources, sourceDetails };
  } catch (error) {
    handleRAGError(error, '获取文件夹查询上下文失败', false);
    return { context: '', sources: [], sourceDetails: [] };
  }
}
