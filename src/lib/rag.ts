import { readTextFile, readDir, BaseDirectory, DirEntry } from "@tauri-apps/plugin-fs";
import { fetchEmbedding, fetchEmbeddings, rerankDocuments } from "./ai";
import {
  deleteVectorDocumentsByFilename,
  getSimilarDocuments,
  getVectorDocumentsByFilename,
  replaceVectorDocumentsByFilename,
  initVectorDb,
  normalizeVectorDocumentKey,
  VectorDocument
} from "@/db/vector";
import { deleteKnowledgeSource, upsertKnowledgeSource, updateKnowledgeSourceIndexState } from '@/db/knowledge';
import { createKnowledgeSourceKey, parseKnowledgeSourceKey } from '@/types/knowledge';
import { invoke } from "@tauri-apps/api/core";
import {
  BM25Document,
  createBM25ChunkKey,
  initBM25Index,
  getBM25Index,
  parseBM25ChunkKey
} from "./bm25";

// 重新导出initVectorDb，使其可在其他模块中导入
export { initVectorDb };
import { getFilePathOptions, getWorkspacePath } from "./workspace";
import { DirTree } from "@/stores/article";
import { toast } from "@/hooks/use-toast";
import { join } from "@tauri-apps/api/path";
import { Store } from "@tauri-apps/plugin-store";
import { createHash } from 'crypto';
import { getIdentifierTerms, getLexicalTerms, replaceLexicalTerm } from './lexical-tokenizer';
import { isSkillsFolder } from './skills/utils';
import { getVectorDocumentKey } from './vector-document-key';
import {
  createRetrievalStrategy,
  DEFAULT_EXCLUDED_RAG_PATHS,
  getRagDisplayFilename,
  isPathAllowedForRag,
  normalizeRagPath,
  RetrievalScope,
  RetrievalStrategy
} from './rag-retrieval-policy';

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

function articlePathFromSourceKey(sourceKey: string): string {
  const parsed = parseKnowledgeSourceKey(sourceKey);
  return parsed?.sourceType === 'article' ? parsed.sourceId : sourceKey;
}

const queryEmbeddingCache = new Map<string, { embedding: number[]; expiresAt: number }>();
const QUERY_EMBEDDING_CACHE_TTL = 5 * 60 * 1000;
const QUERY_EMBEDDING_CACHE_LIMIT = 50;

async function getQueryEmbedding(query: string): Promise<number[] | null> {
  const cacheKey = query.normalize('NFKC').trim();
  const cached = queryEmbeddingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.embedding;
  }
  const embedding = await fetchEmbedding(query);
  if (!embedding) return null;
  queryEmbeddingCache.set(cacheKey, {
    embedding,
    expiresAt: Date.now() + QUERY_EMBEDDING_CACHE_TTL
  });
  while (queryEmbeddingCache.size > QUERY_EMBEDDING_CACHE_LIMIT) {
    const oldestKey = queryEmbeddingCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    queryEmbeddingCache.delete(oldestKey);
  }
  return embedding;
}

async function getConfiguredExcludedPaths(store?: Store): Promise<string[]> {
  const targetStore = store || await Store.load('store.json');
  return await targetStore.get<string[]>('ragExcludedPaths') ?? DEFAULT_EXCLUDED_RAG_PATHS;
}

async function resolveRetrievalScope(scope: RetrievalScope = {}, store?: Store): Promise<RetrievalScope> {
  const configuredExcludedPaths = await getConfiguredExcludedPaths(store);
  return {
    includedPaths: scope.includedPaths,
    excludedPaths: Array.from(new Set([...configuredExcludedPaths, ...(scope.excludedPaths || [])]))
  };
}

export async function shouldIndexRagPath(path: string): Promise<boolean> {
  return isPathAllowedForRag(path, await resolveRetrievalScope());
}

/**
 * 并发控制函数 - 限制同时执行的任务数量
 */
async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onProgress?: (completed: number, total: number, taskIndex: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextTaskIndex = 0;
  let completed = 0;

  async function runWorker(): Promise<void> {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex++;

      try {
        results[taskIndex] = await tasks[taskIndex]();
      } finally {
        completed++;
        onProgress?.(completed, tasks.length, taskIndex);
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

interface MarkdownBlock {
  content: string;
  atomic: boolean;
}

function splitLongMarkdownBlock(content: string, chunkSize: number): string[] {
  if (content.length <= chunkSize) return [content];
  const sentences = content.match(/[^.!?。！？\n]+[.!?。！？]?|\n+/g) || [content];
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > chunkSize) {
      parts.push(current.trim());
      current = '';
    }
    if (sentence.length > chunkSize) {
      for (let offset = 0; offset < sentence.length; offset += chunkSize) {
        const slice = sentence.slice(offset, offset + chunkSize).trim();
        if (slice) parts.push(slice);
      }
    } else {
      current += sentence;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseMarkdownBlocks(text: string, chunkSize: number): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  const headings: string[] = [];
  let paragraph: string[] = [];

  const headingPrefix = () => headings.filter(Boolean).join('\n');
  const pushParagraph = () => {
    const body = paragraph.join('\n').trim();
    paragraph = [];
    if (!body) return;
    const prefix = headingPrefix();
    const contextualContent = prefix && !body.startsWith('#') ? `${prefix}\n\n${body}` : body;
    for (const part of splitLongMarkdownBlock(contextualContent, chunkSize)) {
      blocks.push({ content: part, atomic: false });
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      pushParagraph();
      const level = headingMatch[1].length;
      headings.splice(level - 1);
      headings[level - 1] = line.trim();
      continue;
    }

    if (/^\s*(```|~~~)/.test(line)) {
      pushParagraph();
      const marker = line.trim().slice(0, 3);
      const codeLines = [line];
      while (++index < lines.length) {
        codeLines.push(lines[index]);
        if (lines[index].trim().startsWith(marker)) break;
      }
      const prefix = headingPrefix();
      blocks.push({
        content: prefix ? `${prefix}\n\n${codeLines.join('\n')}` : codeLines.join('\n'),
        atomic: true
      });
      continue;
    }

    const nextLine = lines[index + 1] || '';
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(nextLine)) {
      pushParagraph();
      const tableLines = [line, nextLine];
      index++;
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
        tableLines.push(lines[++index]);
      }
      const prefix = headingPrefix();
      blocks.push({
        content: prefix ? `${prefix}\n\n${tableLines.join('\n')}` : tableLines.join('\n'),
        atomic: true
      });
      continue;
    }

    if (!line.trim()) {
      pushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  pushParagraph();
  return blocks;
}

/**
 * Markdown 结构化分块：保留标题上下文，并避免从代码块和表格中间截断。
 */
export function chunkText(
  text: string, 
  chunkSize: number = 1000,
  chunkOverlap: number = 200
): string[] {
  if (!text.trim()) return [];
  if (text.length <= chunkSize) return [text.trim()];

  const blocks = parseMarkdownBlocks(text, chunkSize);
  const chunks: string[] = [];
  let currentBlocks: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (currentBlocks.length === 0) return;
    chunks.push(currentBlocks.join('\n\n').trim());
    const overlapBlocks: string[] = [];
    let overlapLength = 0;
    for (let index = currentBlocks.length - 1; index >= 0; index--) {
      const block = currentBlocks[index];
      if (overlapLength + block.length > chunkOverlap) break;
      overlapBlocks.unshift(block);
      overlapLength += block.length;
    }
    currentBlocks = overlapBlocks;
    currentLength = overlapBlocks.reduce((total, block) => total + block.length + 2, 0);
  };

  for (const block of blocks) {
    if (currentBlocks.length > 0 && currentLength + block.content.length + 2 > chunkSize) {
      flush();
    }
    if (block.atomic && block.content.length > chunkSize) {
      flush();
      chunks.push(block.content.trim());
      currentBlocks = [];
      currentLength = 0;
    } else {
      currentBlocks.push(block.content);
      currentLength += block.content.length + 2;
    }
  }
  flush();
  return chunks.filter(Boolean);
}

/**
 * 初始化 BM25 索引
 * 从工作区的 Markdown 文件构建 BM25 索引
 */
export async function initBM25Search(): Promise<void> {
  try {
    const items = await collectMarkdownContents();
    const { collectCanvasKnowledgeDocuments, collectRecordKnowledgeDocuments } = await import('@/lib/knowledge-content');
    const structuredDocuments = [
      ...await collectRecordKnowledgeDocuments(),
      ...await collectCanvasKnowledgeDocuments(),
    ];
    const store = await Store.load('store.json');
    const chunkSize = await store.get<number>('ragChunkSize');
    const chunkOverlap = await store.get<number>('ragChunkOverlap');
    const documents: BM25Document[] = items.flatMap(item => {
      const filename = createKnowledgeSourceKey('article', getVectorDocumentKey(item.id || item.title || 'unknown'));
      return chunkText(item.article || '', chunkSize, chunkOverlap)
        .filter(content => content.trim().length > 0)
        .map((content, chunkId) => ({
          id: createBM25ChunkKey(filename, chunkId),
          content
        }));
    });
    documents.push(...structuredDocuments.flatMap(document => (
      document.chunks.map((chunk, chunkId) => ({
        id: createBM25ChunkKey(document.sourceKey, chunkId),
        content: chunk.content,
      }))
    )));

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
async function searchWithBM25(query: string, limit: number = 10): Promise<Array<{id: string, score: number, content: string}>> {
  const index = getBM25Index();
  if (!index) {
    console.warn('BM25 索引未初始化，跳过 BM25 搜索');
    return [];
  }

  return index.search(query, limit).flatMap(result => {
    const content = index.getDocument(result.id);
    return content === undefined ? [] : [{ ...result, content }];
  });
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
    const articlePath = getVectorDocumentKey(filePath);
    const vectorDocumentKey = createKnowledgeSourceKey('article', articlePath);
    const legacyFilename = filePath.split('/').pop() || filePath;
    // 空文件也视为成功处理，同时清理它可能遗留的旧索引。
    if (!content || content.trim().length === 0) {
      await deleteVectorDocumentsByFilename(vectorDocumentKey);
      if (legacyFilename !== vectorDocumentKey) {
        await deleteVectorDocumentsByFilename(legacyFilename);
      }
      getBM25Index()?.deleteByFilename(vectorDocumentKey);
      await deleteKnowledgeSource(vectorDocumentKey);
      return true;
    }

    const store = await Store.load('store.json')
    const chunkSize = await store.get<number>('ragChunkSize');
    const chunkOverlap = await store.get<number>('ragChunkOverlap');
    const chunks = chunkText(content, chunkSize, chunkOverlap).filter(chunk => chunk.trim().length > 0);
    const contentHash = generateContentHash(content);
    await upsertKnowledgeSource({
      sourceKey: vectorDocumentKey,
      sourceType: 'article',
      sourceId: articlePath,
      title: articlePath.split('/').pop() || articlePath,
      locator: { filePath: articlePath },
      contentHash,
      indexedHash: null,
      status: 'pending',
      error: null,
      updatedAt: Date.now(),
    });
    // 没有有效分块时清理旧索引，避免空内容仍被检索到。
    if (chunks.length === 0) {
      await deleteVectorDocumentsByFilename(vectorDocumentKey);
      if (legacyFilename !== vectorDocumentKey) {
        await deleteVectorDocumentsByFilename(legacyFilename);
      }
      getBM25Index()?.deleteByFilename(vectorDocumentKey);
      return true;
    }
    const scope = await resolveRetrievalScope({}, store);
    if (!isPathAllowedForRag(articlePath, scope)) {
      await deleteVectorDocumentsByFilename(vectorDocumentKey);
      if (legacyFilename !== vectorDocumentKey) {
        await deleteVectorDocumentsByFilename(legacyFilename);
      }
      getBM25Index()?.deleteByFilename(vectorDocumentKey);
      return true;
    }

    // 字面检索始终使用最新正文，即使后续 Embedding 暂时失败。
    getBM25Index()?.replaceByFilename(vectorDocumentKey, chunks);

    const existingDocuments = await getVectorDocumentsByFilename(vectorDocumentKey);
    const existingChunks = existingDocuments
      .sort((a, b) => a.chunk_id - b.chunk_id)
      .map(document => document.content);
    if (
      existingChunks.length === chunks.length
      && generateContentHash(existingChunks.join('\u0000')) === generateContentHash(chunks.join('\u0000'))
    ) {
      getBM25Index()?.replaceByFilename(vectorDocumentKey, chunks);
      await updateKnowledgeSourceIndexState(vectorDocumentKey, {
        status: 'ready',
        indexedHash: contentHash,
      });
      return true;
    }

    const embeddings: Array<number[] | null> = [];
    const embeddingBatchSize = 16;
    for (let offset = 0; offset < chunks.length; offset += embeddingBatchSize) {
      embeddings.push(...await fetchEmbeddings(chunks.slice(offset, offset + embeddingBatchSize)));
    }
    if (embeddings.length !== chunks.length || embeddings.some(embedding => !embedding)) {
      console.error(`无法完整计算文件 ${vectorDocumentKey} 的向量，旧向量保持休眠并使用最新字面索引`);
      await updateKnowledgeSourceIndexState(vectorDocumentKey, {
        status: 'failed',
        indexedHash: null,
        error: 'Embedding 返回不完整',
      });
      return false;
    }

    // 新向量全部计算成功后再按来源替换；写入失败会恢复该来源旧向量。
    if (legacyFilename !== vectorDocumentKey) {
      await deleteVectorDocumentsByFilename(legacyFilename);
    }

    await replaceVectorDocumentsByFilename(
      vectorDocumentKey,
      chunks.flatMap((chunk, index) => {
        const embedding = embeddings[index];
        return embedding ? [{
        filename: vectorDocumentKey,
        chunk_id: index,
        content: chunk,
        embedding: JSON.stringify(embedding),
        updated_at: Date.now()
        }] : [];
      })
    );

    const bm25Index = getBM25Index();
    if (bm25Index) {
      bm25Index.replaceByFilename(
        vectorDocumentKey,
        chunks
      );
    }

    await updateKnowledgeSourceIndexState(vectorDocumentKey, {
      status: 'ready',
      indexedHash: contentHash,
    });

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
  paused: boolean;
  failedFiles: Array<{fileName: string, error: string}>;
}> {
  try {
    // 获取工作区中的所有文件
    const fileTree = await getWorkspaceFiles();
    const retrievalScope = await resolveRetrievalScope();

    // 收集所有需要处理的文件
    const filesToProcess: Array<{name: string, path: string}> = [];

    async function collectFiles(tree: DirTree[]): Promise<void> {
      for (const item of tree) {
        if (item.isFile && item.name.endsWith('.md')) {
          const filePath = await getFilePath(item);
          if (isPathAllowedForRag(filePath, retrievalScope)) {
            filesToProcess.push({ name: item.name, path: filePath });
          }
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
          const taskStore = await Store.load('store.json');
          if (await taskStore.get<boolean>('ragKnowledgeIndexPaused') ?? false) {
            return { success: false, paused: true, fileName: file.name, error: null };
          }
          const success = await processMarkdownFile(file.path);
          return { success, paused: false, fileName: file.name, error: null };
        } catch (error) {
          handleRAGError(error, `处理文件 ${file.name} 失败`, false);
          return { success: false, paused: false, fileName: file.name, error: String(error) };
        }
      }),
      3, // 并发限制为 3，避免过多 API 调用
      (completed, total, taskIndex) => {
        if (onProgress && completed > 0) {
          const currentFile = filesToProcess[taskIndex]?.name || '';
          onProgress(completed, total, currentFile);
        }
      }
    );

    // 统计结果
    const failedFiles: Array<{fileName: string, error: string}> = [];
    let success = 0;
    let failed = 0;
    let paused = false;

    for (const result of results) {
      if (result.paused) {
        paused = true;
        continue;
      }
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
      paused,
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
async function collectMarkdownContents(scope: RetrievalScope = {}): Promise<SearchItem[]> {
  try {
    // 获取工作区中的所有文件
    const fileTree = await getWorkspaceFiles();
    const items: SearchItem[] = [];
    const resolvedScope = await resolveRetrievalScope(scope);
    
    // 递归处理文件树
    async function processTree(tree: DirTree[]): Promise<void> {
      for (const item of tree) {
        if (item.isFile && item.name.endsWith('.md')) {
          // 获取完整路径
          const filePath = await getFilePath(item);
          if (!isPathAllowedForRag(filePath, resolvedScope)) continue;
          
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
  stableId: string;
  filename: string;
  filepath: string;
  content: string;
  rawScore: number;      // 原始分数（未归一化）
  normalizedScore: number; // 归一化后的分数
  rank: number;
  queryWeight: number;
  keyword?: string;
  type: 'fuzzy' | 'vector' | 'bm25';
  matchedTypes?: Array<'fuzzy' | 'vector' | 'bm25'>;
}

function createChunkStableId(filename: string, chunkId: number): string {
  return createBM25ChunkKey(filename, chunkId);
}

async function resolveSnippetToChunk(
  filepath: string,
  snippet: string
): Promise<{ stableId: string; filename: string; content: string }> {
  const filename = normalizeVectorDocumentKey(getVectorDocumentKey(filepath));
  const chunks = await getVectorDocumentsByFilename(filename);
  if (chunks.length === 0) {
    return {
      stableId: `${filename}::content::${generateContentHash(snippet)}`,
      filename,
      content: snippet
    };
  }

  const bestChunk = chunks.reduce((best, current) =>
    calculateContentOverlap(current.content, snippet) > calculateContentOverlap(best.content, snippet)
      ? current
      : best
  );
  return {
    stableId: createChunkStableId(filename, bestChunk.chunk_id),
    filename,
    content: bestChunk.content
  };
}

interface LexicalQuery {
  text: string;
  weight: number;
}

/** 保留完整查询，只生成少量完整句子的同义词变体，不依赖关键词排序。 */
function buildLexicalQueries(query: string, enableExpansion: boolean, maxVariants: number): LexicalQuery[] {
  const original = query.normalize('NFKC').trim().toLowerCase();
  const queries: LexicalQuery[] = [{ text: original, weight: 1 }];
  if (!enableExpansion) return queries;

  const limit = Number.isFinite(maxVariants) ? Math.min(5, Math.max(1, Math.trunc(maxVariants))) : 3;
  const terms = getLexicalTerms(original);
  for (const [term, synonyms] of Object.entries(SYNONYM_DICT)) {
    // 中文词可出现在连续文本中；空格语言必须匹配完整词，避免 ai 匹配到 contain。
    const matches = /\p{Script=Han}/u.test(term)
      ? terms.some(candidate => candidate.includes(term))
      : terms.includes(term);
    if (!matches || isStopWord(term)) continue;
    for (const synonym of synonyms) {
      if (queries.length >= limit) return queries;
      const text = replaceLexicalTerm(original, term, synonym);
      if (!queries.some(item => item.text === text)) {
        queries.push({ text, weight: 0.5 });
      }
    }
  }
  return queries;
}

function buildFuzzyQueries(query: string, strategy: RetrievalStrategy): LexicalQuery[] {
  const terms = strategy.kind === 'short'
    ? [query.normalize('NFKC').trim(), ...getIdentifierTerms(query)]
    : getIdentifierTerms(query);
  return Array.from(new Set(terms.filter(term => term && !isStopWord(term))))
    .slice(0, 4)
    .map(text => ({ text, weight: 1 }));
}

/**
 * RAG 来源详情类型定义
 */
export interface RagSource {
  filepath: string;  // 文件的相对路径
  filename: string;  // 文件名
  content: string;   // 引用的文本片段
}

export interface RagDiagnosticResult extends RagSource {
  rank: number;
  beforeRerankRank: number;
  fusedScore: number;
  finalScore: number;
  retrievers: Array<'fuzzy' | 'vector' | 'bm25'>;
}

export interface RagSearchResponse {
  context: string;
  sources: string[];
  sourceDetails: RagSource[];
  diagnostics: RagDiagnosticResult[];
}

/**
 * 根据完整查询执行词法与语义混合检索
 * @param query 用户的完整查询，用于保留语义意图的向量检索和统一重排
 * @returns 包含上下文文本和引用文件名的对象
 */
export async function getContextForQuery(
  query: string,
  scope: RetrievalScope = {}
): Promise<RagSearchResponse> {
  try {
    const store = await Store.load('store.json');
    const resultCount = await store.get<number>('ragResultCount') ?? 5;
    const similarityThreshold = await store.get<number>('ragSimilarityThreshold') ?? 0.25;
    const rerankThreshold = await store.get<number>('ragRerankThreshold') ?? 0.1;

    // 读取权重配置（新增配置项）
    const fuzzyWeight = await store.get<number>('ragFuzzyWeight') ?? 0.2;
    const vectorWeight = await store.get<number>('ragVectorWeight') ?? 0.7;
    const bm25Weight = await store.get<number>('ragBm25Weight') ?? 0.1;

    const baseWeights = {
      fuzzyWeight,
      vectorWeight,
      bm25Weight
    };
    const strategy = createRetrievalStrategy(query, baseWeights, rerankThreshold);
    const resolvedScope = await resolveRetrievalScope(scope, store);

    // 存储所有检索结果（使用新的 SearchResult 类型）
    const allResults: SearchResult[] = [];

    // 完整查询为空时无法执行语义检索
    if (!query.trim()) {
      return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
    }

    // 读取查询扩展配置
    const enableQueryExpansion = await store.get<boolean>('ragEnableQueryExpansion') ?? true;
    const maxQueryVariations = await store.get<number>('ragMaxQueryVariations') ?? 3;

    const lexicalQueries = buildLexicalQueries(query, enableQueryExpansion, maxQueryVariations);
    const fuzzyQueries = buildFuzzyQueries(query, strategy);
    const items = await collectMarkdownContents(resolvedScope);
    const allowedVectorKeys = new Set(items.map(item => (
      createKnowledgeSourceKey('article', getVectorDocumentKey(item.id || item.title || ''))
    )));

    // 1. 短查询和明确标识符使用模糊搜索
    try {
      if (items.length > 0) {
        // 限制补充查询数量，避免对长问题逐词扫描全文
        for (const keyword of fuzzyQueries) {
          // 短查询或标识符单独补充召回。
          const fuzzyResults: FuzzySearchResult[] = await invoke('fuzzy_search', {
            items,
            query: keyword.text,
            keys: ['title', 'article'],
            threshold: strategy.fuzzyThreshold,
            includeScore: true,
            includeMatches: true
          });

          // 处理模糊搜索结果
          for (const [resultIndex, result] of fuzzyResults.entries()) {
            if (result.score > 0) {
              const item = result.item;
              // 提取匹配的文本片段作为上下文
              const match = result.matches.find(m => m.key === 'article');
              const content = match?.value || item.article || '';
              if (content.trim()) {
                // 正文命中截取邻近上下文；仅标题命中时取正文开头。
                let startIdx = 0;
                let endIdx = Math.min(content.length, 500);
                if (match && match.indices.length > 0) {
                  const firstMatch = match.indices[0];
                  startIdx = Math.max(0, firstMatch[0] - 250);
                  endIdx = Math.min(content.length, firstMatch[1] + 250);
                }

                const contextSnippet = content.substring(startIdx, endIdx);
                const filepath = item.id || item.title || '未命名文件';
                const resolvedChunk = await resolveSnippetToChunk(filepath, contextSnippet);

                allResults.push({
                  stableId: resolvedChunk.stableId,
                  filename: resolvedChunk.filename,
                  filepath,
                  content: resolvedChunk.content,
                  rawScore: result.score,
                  normalizedScore: 0, // 稍后计算
                  rank: resultIndex + 1,
                  queryWeight: keyword.weight,
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

    // 2. 使用完整问题进行一次向量搜索，保留查询的完整语义和关系
    try {
      const queryEmbedding = await getQueryEmbedding(query);

      if (queryEmbedding) {
        const vectorCandidateCount = Math.max(resultCount * strategy.vectorCandidateMultiplier, 20);
        const similarDocs = await getSimilarDocuments(
          queryEmbedding,
          vectorCandidateCount,
          similarityThreshold,
          allowedVectorKeys
        );

        for (const [docIndex, doc] of similarDocs.entries()) {
          allResults.push({
            stableId: createChunkStableId(doc.filename, doc.chunk_id),
            filename: doc.filename,
            filepath: articlePathFromSourceKey(doc.filename),
            content: doc.content,
            rawScore: doc.similarity || 0,
            normalizedScore: 0,
            rank: docIndex + 1,
            queryWeight: 1,
            type: 'vector'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, '向量搜索失败', false);
    }

    // 3. 使用 BM25 搜索找到相关文档
    try {
      for (const lexicalQuery of lexicalQueries) {
        const bm25Results = await searchWithBM25(
          lexicalQuery.text,
          Math.max(resultCount * strategy.lexicalCandidateMultiplier, 20)
        );

        for (const [resultIndex, result] of bm25Results.entries()) {
          const chunkKey = parseBM25ChunkKey(result.id);
          if (!chunkKey || !allowedVectorKeys.has(chunkKey.filename)) continue;
          allResults.push({
            stableId: result.id,
            filename: chunkKey.filename,
            filepath: articlePathFromSourceKey(chunkKey.filename),
            content: result.content,
            rawScore: result.score,
            normalizedScore: 0,
            rank: resultIndex + 1,
            queryWeight: lexicalQuery.weight,
            keyword: lexicalQuery.text,
            type: 'bm25'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, 'BM25 搜索失败', false);
    }

    // 如果没有找到任何相关上下文，返回空结果
    if (allResults.length === 0) {
      return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
    }

    const windowSize = await store.get<number>('ragWindowSize') ?? 2;
    return await finalizeSearchResults(query, allResults, strategy, resultCount, windowSize);
  } catch (error) {
    handleRAGError(error, '获取查询上下文失败', false);
    return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
  }
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
  const docGroups = new Map<string, SearchResult[]>();

  for (const result of results) {
    if (!docGroups.has(result.stableId)) {
      docGroups.set(result.stableId, []);
    }
    docGroups.get(result.stableId)!.push(result);
  }

  const mergedResults: SearchResult[] = [];
  const sanitizedWeights = {
    fuzzy: Math.max(0, weights.fuzzyWeight),
    vector: Math.max(0, weights.vectorWeight),
    bm25: Math.max(0, weights.bm25Weight)
  };
  const totalWeight = sanitizedWeights.fuzzy + sanitizedWeights.vector + sanitizedWeights.bm25;
  const weightByType = totalWeight > 0
    ? {
        fuzzy: sanitizedWeights.fuzzy / totalWeight,
        vector: sanitizedWeights.vector / totalWeight,
        bm25: sanitizedWeights.bm25 / totalWeight
      }
    : { fuzzy: 1 / 3, vector: 1 / 3, bm25: 1 / 3 };
  const maxRawScoreByType = new Map<SearchResult['type'], number>();
  const maxQueryWeightByType = new Map<SearchResult['type'], number>();
  for (const result of results) {
    maxRawScoreByType.set(
      result.type,
      Math.max(maxRawScoreByType.get(result.type) || 0, Math.max(0, result.rawScore))
    );
    maxQueryWeightByType.set(
      result.type,
      Math.max(maxQueryWeightByType.get(result.type) || 0, Math.max(0, result.queryWeight))
    );
  }
  const reciprocalRankConstant = 20;
  const rankBlend = 0.75;

  for (const group of docGroups.values()) {
    const bestContributionByType = new Map<SearchResult['type'], number>();
    for (const result of group) {
      const normalizedRank = (reciprocalRankConstant + 1)
        / (reciprocalRankConstant + Math.max(1, result.rank));
      const maxRawScore = maxRawScoreByType.get(result.type) || 0;
      const normalizedConfidence = maxRawScore > 0
        ? Math.min(1, Math.max(0, result.rawScore) / maxRawScore)
        : 0;
      const maxQueryWeight = maxQueryWeightByType.get(result.type) || 1;
      const normalizedQueryWeight = Math.min(1, Math.max(0, result.queryWeight) / maxQueryWeight);
      const contribution = weightByType[result.type]
        * (rankBlend * normalizedRank + (1 - rankBlend) * normalizedConfidence)
        * normalizedQueryWeight;
      bestContributionByType.set(
        result.type,
        Math.max(bestContributionByType.get(result.type) || 0, contribution)
      );
    }
    const hybridScore = Array.from(bestContributionByType.values())
      .reduce((total, contribution) => total + contribution, 0);
    const bestResult = group.find(result => result.type === 'vector') || group[0];
    const keywords = Array.from(new Set(group.flatMap(result => result.keyword ? [result.keyword] : [])));

    mergedResults.push({
      ...bestResult,
      rawScore: hybridScore,
      normalizedScore: hybridScore,
      keyword: keywords.join(', '),
      matchedTypes: Array.from(new Set(group.map(result => result.type)))
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
 * 合并候选、去除重叠片段，并使用完整问题统一重排。
 * 句子窗口在重排完成后扩展，避免较长的相邻内容干扰相关性判断。
 */
async function finalizeSearchResults(
  query: string,
  allResults: SearchResult[],
  strategy: RetrievalStrategy,
  resultCount: number,
  windowSize: number
): Promise<RagSearchResponse> {
  const queryTerms = getLexicalTerms(query);
  const normalizedQuery = query.normalize('NFKC').toLowerCase().trim();
  const exactIdentifier = strategy.kind === 'exact'
    && queryTerms.length === 1
    && queryTerms[0] === normalizedQuery
    ? normalizedQuery : undefined;
  // 单独查询错误码、版本号或文件名时，语义相似不能代替该标识符的实际命中。
  const candidates = exactIdentifier
    ? allResults.filter(result => (
        getLexicalTerms(result.content).includes(exactIdentifier)
        || getLexicalTerms(result.filepath).some(term => (
          term === exactIdentifier || term.endsWith(`/${exactIdentifier}`)
        ))
      ))
    : allResults;
  if (candidates.length === 0) {
    return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
  }
  const mergedResults = mergeResultsByDocument(candidates, strategy.weights);
  const uniqueResults: SearchResult[] = [];
  const mergedIndices = new Set<number>();

  for (let i = 0; i < mergedResults.length; i++) {
    if (mergedIndices.has(i)) continue;

    const current = mergedResults[i];
    let bestResult = current;
    const mergedKeywords = new Set<string>();

    if (current.keyword) {
      mergedKeywords.add(current.keyword);
    }

    for (let j = i + 1; j < mergedResults.length; j++) {
      if (mergedIndices.has(j)) continue;

      const other = mergedResults[j];
      if (other.filename !== current.filename) continue;

      if (calculateContentOverlap(current.content, other.content) > 0.7) {
        mergedIndices.add(j);
        if (other.normalizedScore > bestResult.normalizedScore) {
          bestResult = other;
        }
        if (other.keyword) {
          mergedKeywords.add(other.keyword);
        }
      }
    }

    uniqueResults.push({
      ...bestResult,
      keyword: Array.from(mergedKeywords).join(', ')
    });
  }

  uniqueResults.sort((a, b) => b.normalizedScore - a.normalizedScore);

  // 每种检索器都保留一组候选，避免向量权重较高时挤掉精确编号等词法命中。
  const rerankCandidateCount = Math.max(
    resultCount * Math.max(strategy.vectorCandidateMultiplier, strategy.lexicalCandidateMultiplier),
    20
  );
  const perRetrieverCandidateCount = Math.max(resultCount, 5);
  const uniqueResultById = new Map(uniqueResults.map(result => [result.stableId, result]));
  const selectedCandidateIds = new Set<string>();

  for (const type of ['vector', 'bm25', 'fuzzy'] as const) {
    const typeResults = candidates
      .filter(result => result.type === type)
      .sort((a, b) => a.rank - b.rank);
    const selectedForType = new Set<string>();
    for (const result of typeResults) {
      if (!uniqueResultById.has(result.stableId) || selectedForType.has(result.stableId)) continue;
      selectedForType.add(result.stableId);
      selectedCandidateIds.add(result.stableId);
      if (selectedForType.size >= perRetrieverCandidateCount) break;
    }
  }

  for (const result of uniqueResults) {
    if (selectedCandidateIds.size >= rerankCandidateCount) break;
    selectedCandidateIds.add(result.stableId);
  }

  // 即使 rerank 不可用或请求失败，也保持融合分数顺序，不退化为检索器插入顺序。
  const rerankCandidates = uniqueResults
    .filter(result => selectedCandidateIds.has(result.stableId))
    .slice(0, rerankCandidateCount);
  const fusedRankById = new Map(rerankCandidates.map((result, index) => [result.stableId, index + 1]));
  const fusedScoreById = new Map(rerankCandidates.map(result => [result.stableId, result.normalizedScore]));
  const rerankDocumentsInput = rerankCandidates.map((result, index) => ({
    id: index,
    filename: result.filename,
    content: result.content,
    similarity: result.normalizedScore
  }));
  const rerankedDocuments = await rerankDocuments(
    query,
    rerankDocumentsInput,
    strategy.rerankThreshold
  );
  let finalResults = rerankedDocuments.slice(0, resultCount).map(document => ({
    ...rerankCandidates[document.id],
    rawScore: document.similarity,
    normalizedScore: document.similarity
  }));

  // 仅对最终命中的向量块扩展相邻窗口，避免窗口文本影响候选融合和重排。
  const chunkResults = finalResults.flatMap((result, index) => parseBM25ChunkKey(result.stableId)
    ? [{
        id: index,
        filename: result.filename,
        content: result.content,
        similarity: result.normalizedScore
      }]
    : []
  );

  if (chunkResults.length > 0 && windowSize > 0) {
    const expandedVectorResults = await expandWithSentenceWindow(chunkResults, windowSize);
    const expandedContentByIndex = new Map(
      expandedVectorResults.map(result => [result.id, result.content])
    );

    finalResults = finalResults.map((result, index) => ({
      ...result,
      content: expandedContentByIndex.get(index) ?? result.content
    }));
  }

  const sources = Array.from(new Set(finalResults.map(result => getRagDisplayFilename(result.filepath))));
  const sourceDetailsMap = new Map<string, RagSource>();

  for (const result of finalResults) {
    if (!sourceDetailsMap.has(result.filepath)) {
      sourceDetailsMap.set(result.filepath, {
        filepath: result.filepath,
        filename: getRagDisplayFilename(result.filepath),
        content: result.content
      });
    }
  }

  const sourceDetails = Array.from(sourceDetailsMap.values());
  const diagnostics = finalResults.map((result, index): RagDiagnosticResult => ({
    rank: index + 1,
    beforeRerankRank: fusedRankById.get(result.stableId) || index + 1,
    fusedScore: fusedScoreById.get(result.stableId) || result.normalizedScore,
    finalScore: result.normalizedScore,
    retrievers: result.matchedTypes || [result.type],
    filepath: result.filepath,
    filename: getRagDisplayFilename(result.filepath),
    content: result.content
  }));
  const context = finalResults.map(result => `文件：${normalizeRagPath(result.filepath)}
${result.content}
`).join('\n---\n\n');

  return { context, sources, sourceDetails, diagnostics };
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
async function collectMarkdownContentsInFolder(
  folderPath: string,
  scope: RetrievalScope = {}
): Promise<SearchItem[]> {
  try {
    const workspace = await getWorkspacePath();
    const items: SearchItem[] = [];
    const resolvedScope = await resolveRetrievalScope(scope);

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
        const ragPath = workspace.isCustom ? await join(dirPath, entry.name) : entryRelativePath;
        if (!isPathAllowedForRag(ragPath, resolvedScope)) continue;

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
              id: workspace.isCustom ? entryFullPath : entryRelativePath,
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
 * @param query 用户的完整查询
 * @param folderPath 文件夹相对路径
 * @returns 包含上下文文本和引用文件名的对象
 */
export async function getContextForQueryInFolder(
  query: string,
  folderPath: string
): Promise<RagSearchResponse> {
  try {
    const store = await Store.load('store.json');
    const resultCount = await store.get<number>('ragResultCount') ?? 5;
    const similarityThreshold = await store.get<number>('ragSimilarityThreshold') ?? 0.25;
    const rerankThreshold = await store.get<number>('ragRerankThreshold') ?? 0.1;

    // 读取权重配置
    const fuzzyWeight = await store.get<number>('ragFuzzyWeight') ?? 0.2;
    const vectorWeight = await store.get<number>('ragVectorWeight') ?? 0.7;
    const bm25Weight = await store.get<number>('ragBm25Weight') ?? 0.1;

    const baseWeights = {
      fuzzyWeight,
      vectorWeight,
      bm25Weight
    };
    const strategy = createRetrievalStrategy(query, baseWeights, rerankThreshold);

    const allResults: SearchResult[] = [];

    if (!query.trim()) {
      return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
    }

    // 读取查询扩展配置
    const enableQueryExpansion = await store.get<boolean>('ragEnableQueryExpansion') ?? true;
    const maxQueryVariations = await store.get<number>('ragMaxQueryVariations') ?? 3;

    const lexicalQueries = buildLexicalQueries(query, enableQueryExpansion, maxQueryVariations);
    const fuzzyQueries = buildFuzzyQueries(query, strategy);

    // 收集文件夹范围内的文件
    const items = await collectMarkdownContentsInFolder(folderPath);
    const folderVectorKeys = new Set(items.map(item => (
      createKnowledgeSourceKey('article', getVectorDocumentKey(item.id || item.title || ''))
    )));

    // 1. 模糊搜索（限定到文件夹）
    try {
      if (items.length > 0) {
        for (const keyword of fuzzyQueries) {
          const fuzzyResults: FuzzySearchResult[] = await invoke('fuzzy_search', {
            items,
            query: keyword.text,
            keys: ['title', 'article'],
            threshold: strategy.fuzzyThreshold,
            includeScore: true,
            includeMatches: true
          });

          for (const [resultIndex, result] of fuzzyResults.entries()) {
            if (result.score > 0) {
              const item = result.item;
              const match = result.matches.find(m => m.key === 'article');
              const content = match?.value || item.article || '';
              if (content.trim()) {
                let startIdx = 0;
                let endIdx = Math.min(content.length, 500);
                if (match && match.indices.length > 0) {
                  const firstMatch = match.indices[0];
                  startIdx = Math.max(0, firstMatch[0] - 250);
                  endIdx = Math.min(content.length, firstMatch[1] + 250);
                }

                const contextSnippet = content.substring(startIdx, endIdx);
                const filepath = item.id || item.title || '未命名文件';
                const resolvedChunk = await resolveSnippetToChunk(filepath, contextSnippet);

                allResults.push({
                  stableId: resolvedChunk.stableId,
                  filename: resolvedChunk.filename,
                  filepath,
                  content: resolvedChunk.content,
                  rawScore: result.score,
                  normalizedScore: 0,
                  rank: resultIndex + 1,
                  queryWeight: keyword.weight,
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

    // 2. 使用完整问题执行一次向量搜索，并过滤到文件夹范围
    try {
      const queryEmbedding = await getQueryEmbedding(query);
      if (queryEmbedding) {
        const vectorCandidateCount = Math.max(resultCount * strategy.vectorCandidateMultiplier, 20);
        const similarDocs = (await getSimilarDocuments(
          queryEmbedding,
          vectorCandidateCount,
          similarityThreshold,
          folderVectorKeys
        ));

        for (const [docIndex, doc] of similarDocs.entries()) {
          allResults.push({
            stableId: createChunkStableId(doc.filename, doc.chunk_id),
            filename: doc.filename,
            filepath: articlePathFromSourceKey(doc.filename),
            content: doc.content,
            rawScore: doc.similarity || 0,
            normalizedScore: 0,
            rank: docIndex + 1,
            queryWeight: 1,
            type: 'vector'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, '向量搜索失败', false);
    }

    // 3. 使用 BM25 搜索找到相关文档（限定到文件夹范围）
    try {
      for (const lexicalQuery of lexicalQueries) {
        const bm25Results = await searchWithBM25(
          lexicalQuery.text,
          Math.max(resultCount * strategy.lexicalCandidateMultiplier, 20)
        );

        for (const [resultIndex, result] of bm25Results.entries()) {
          const chunkKey = parseBM25ChunkKey(result.id);
          if (!chunkKey || !folderVectorKeys.has(chunkKey.filename)) continue;
          allResults.push({
            stableId: result.id,
            filename: chunkKey.filename,
            filepath: articlePathFromSourceKey(chunkKey.filename),
            content: result.content,
            rawScore: result.score,
            normalizedScore: 0,
            rank: resultIndex + 1,
            queryWeight: lexicalQuery.weight,
            keyword: lexicalQuery.text,
            type: 'bm25'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, 'BM25 搜索失败', false);
    }

    // 如果没有找到任何相关上下文，返回空结果
    if (allResults.length === 0) {
      return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
    }

    const windowSize = await store.get<number>('ragWindowSize') ?? 2;
    return await finalizeSearchResults(query, allResults, strategy, resultCount, windowSize);
  } catch (error) {
    handleRAGError(error, '获取文件夹查询上下文失败', false);
    return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
  }
}
