import { tokenizeLexicalText } from './lexical-tokenizer';

/**
 * BM25 检索模块
 * 中文友好的 BM25 算法实现，无需外部分词库
 */

/**
 * 文档项结构
 */
export interface BM25Document {
  id: string;           // 文档唯一标识（通常用文件名）
  content: string;      // 文档内容
}

/**
 * 检索结果
 */
export interface BM25Result {
  id: string;           // 文档ID
  score: number;        // BM25 分数
}

const CHUNK_KEY_SEPARATOR = '::rag-chunk::';

export function createBM25ChunkKey(filename: string, chunkId: number): string {
  return `${filename}${CHUNK_KEY_SEPARATOR}${chunkId}`;
}

export function parseBM25ChunkKey(id: string): { filename: string; chunkId: number } | null {
  const separatorIndex = id.lastIndexOf(CHUNK_KEY_SEPARATOR);
  if (separatorIndex < 0) return null;

  const chunkId = Number(id.slice(separatorIndex + CHUNK_KEY_SEPARATOR.length));
  if (!Number.isInteger(chunkId) || chunkId < 0) return null;

  return { filename: id.slice(0, separatorIndex), chunkId };
}

function countDocumentTerms(content: string) {
  const tokens = tokenizeLexicalText(content);
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return { frequencies, length: tokens.length };
}

/**
 * BM25 索引类
 */
export class BM25Index {
  private documents: Map<string, string> = new Map(); // id -> content
  private docVectors: Map<string, Map<string, number>> = new Map(); // id -> token -> frequency
  private idfCache: Map<string, number> = new Map(); // token -> IDF
  private docLengths: Map<string, number> = new Map(); // id -> document length
  private averageDocLength: number = 0;

  // BM25 参数
  private k1: number;  // 词频饱和参数
  private b: number;   // 长度归一化参数

  constructor(k1: number = 1.2, b: number = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  getStats(): { chunkCount: number; documentCount: number } {
    const filenames = new Set<string>();
    for (const id of this.documents.keys()) {
      filenames.add(parseBM25ChunkKey(id)?.filename || id);
    }
    return {
      chunkCount: this.documents.size,
      documentCount: filenames.size
    };
  }

  /**
   * 构建索引
   * @param documents 文档列表
   */
  index(documents: BM25Document[], previous: BM25Index = this): void {
    const oldDocuments = previous.documents;
    const oldVectors = previous.docVectors;
    const oldLengths = previous.docLengths;
    this.documents = new Map();
    this.docVectors = new Map();
    this.docLengths = new Map();
    this.idfCache.clear();
    const N = documents.length;
    let totalLength = 0;
    for (const doc of documents) {
      const existing = oldDocuments.get(doc.id) === doc.content ? oldVectors.get(doc.id) : undefined;
      const { frequencies, length } = existing
        ? { frequencies: existing, length: oldLengths.get(doc.id) ?? 0 }
        : countDocumentTerms(doc.content);
      this.documents.set(doc.id, doc.content);
      this.docVectors.set(doc.id, frequencies);
      this.docLengths.set(doc.id, length);
      totalLength += length;
    }

    // 2. 计算平均文档长度
    this.averageDocLength = N > 0 ? totalLength / N : 0;

    // 3. 计算 IDF
    this.calculateIDF(N);
  }

  /**
   * 计算 IDF（逆文档频率）
   * @param N 总文档数
   */
  private calculateIDF(N: number): void {
    // 统计每个 token 出现在多少个文档中
    const docFreq = new Map<string, number>();

    for (const [, tokenFreq] of this.docVectors.entries()) {
      for (const token of tokenFreq.keys()) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    // 计算 IDF：log((N - df + 0.5) / (df + 0.5) + 1)
    for (const [token, df] of docFreq.entries()) {
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      this.idfCache.set(token, idf);
    }
  }

  /**
   * 搜索
   * @param query 查询文本
   * @param limit 返回结果数量限制
   * @returns 排序后的检索结果
   */
  search(query: string, limit: number = 10): BM25Result[] {
    const queryTokens = Array.from(new Set(tokenizeLexicalText(query)));

    const results: Map<string, number> = new Map();

    // 对每个文档计算 BM25 分数
    for (const [docId, docVector] of this.docVectors.entries()) {
      const score = this.scoreTerms(queryTokens, docVector, this.docLengths.get(docId) ?? 0);
      if (score > 0) {
        results.set(docId, score);
      }
    }

    // 按分数降序排序
    const sortedResults = Array.from(results.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }));

    return sortedResults;
  }

  /** Score a verified view using the corpus IDF, including when only some source contributions are visible. */
  scoreDocument(terms: readonly string[], id: string, content: string): number {
    const cached = this.documents.get(id) === content ? this.docVectors.get(id) : undefined;
    if (cached) return this.scoreTerms(terms, cached, this.docLengths.get(id) ?? 0);
    const { frequencies, length } = countDocumentTerms(content);
    return this.scoreTerms(terms, frequencies, length);
  }

  private scoreTerms(terms: readonly string[], vector: Map<string, number>, length: number): number {
    let score = 0;
    for (const token of terms) {
      const freq = vector.get(token);
      if (!freq) continue;
      // A filtered topic can contain evidence omitted from the compiled page.
      const idf = this.idfCache.get(token) ?? Math.log1p((this.documents.size - 0.5) / 1.5);
      const norm = 1 - this.b + this.b * length / (this.averageDocLength || 1);
      score += idf * freq * (this.k1 + 1) / (freq + this.k1 * norm);
    }
    return score;
  }

  /**
   * 更新单个文档
   * @param document 要更新的文档
   */
  update(document: BM25Document): void {
    const documents = new Map(this.documents);
    documents.set(document.id, document.content);
    this.index(Array.from(documents, ([id, content]) => ({ id, content })));
  }

  replaceByFilename(filename: string, chunks: string[]): void {
    const documents = new Map(this.documents);
    for (const id of documents.keys()) {
      if (parseBM25ChunkKey(id)?.filename === filename || id === filename) {
        documents.delete(id);
      }
    }
    chunks.forEach((content, chunkId) => {
      documents.set(createBM25ChunkKey(filename, chunkId), content);
    });
    this.index(Array.from(documents, ([id, content]) => ({ id, content })));
  }

  deleteByFilename(filename: string): void {
    this.replaceByFilename(filename, []);
  }

  deleteByFilenamePrefix(prefix: string): void {
    const documents = new Map(this.documents);
    for (const id of documents.keys()) {
      const filename = parseBM25ChunkKey(id)?.filename;
      if (filename && (filename === prefix || filename.startsWith(`${prefix}/`))) {
        documents.delete(id);
      }
    }
    this.index(Array.from(documents, ([id, content]) => ({ id, content })));
  }

  renameFilename(oldFilename: string, newFilename: string): void {
    if (oldFilename === newFilename) return;
    const chunks = Array.from(this.documents.entries())
      .flatMap(([id, content]) => {
        const parsed = parseBM25ChunkKey(id);
        return parsed?.filename === oldFilename ? [{ chunkId: parsed.chunkId, content }] : [];
      })
      .sort((a, b) => a.chunkId - b.chunkId)
      .map(chunk => chunk.content);
    this.deleteByFilename(oldFilename);
    if (chunks.length > 0) {
      this.replaceByFilename(newFilename, chunks);
    }
  }

  renameFilenamePrefix(oldPrefix: string, newPrefix: string): void {
    const documents = new Map(this.documents);
    for (const [id, content] of this.documents.entries()) {
      const parsed = parseBM25ChunkKey(id);
      if (parsed && (parsed.filename === oldPrefix || parsed.filename.startsWith(`${oldPrefix}/`))) {
        documents.delete(id);
        const suffix = parsed.filename.slice(oldPrefix.length);
        documents.set(createBM25ChunkKey(`${newPrefix}${suffix}`, parsed.chunkId), content);
      }
    }
    this.index(Array.from(documents, ([id, content]) => ({ id, content })));
  }

  getDocument(docId: string): string | undefined {
    return this.documents.get(docId);
  }

  /**
   * 删除文档
   * @param docId 文档ID
   */
  delete(docId: string): void {
    if (!this.documents.has(docId)) {
      return;
    }

    // 删除文档
    this.documents.delete(docId);
    this.docVectors.delete(docId);
    this.docLengths.delete(docId);

    // 重新计算 IDF（因为文档频率变了）
    this.calculateIDF(this.documents.size);

    // 重新计算平均文档长度
    const totalLength = Array.from(this.docLengths.values()).reduce((a, b) => a + b, 0);
    this.averageDocLength = this.documents.size > 0 ? totalLength / this.documents.size : 0;
  }

  /**
   * 获取索引中的文档数量
   */
  size(): number {
    return this.documents.size;
  }

  /**
   * 清空索引
   */
  clear(): void {
    this.documents.clear();
    this.docVectors.clear();
    this.idfCache.clear();
    this.docLengths.clear();
    this.averageDocLength = 0;
  }
}
