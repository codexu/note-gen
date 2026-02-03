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

  /**
   * 中文友好的分词函数
   * 采用混合策略：边界分割 + 过滤单字 + 过滤数字
   *
   * 示例：
   * "RAG检索增强生成系统用于智能问答"
   * -> ["RAG", "检索", "增强", "生成", "系统", "用于", "智能", "问答"]
   */
  private tokenize(text: string): string[] {
    // 1. 按边界分割：标点、空格、中英文边界
    // 匹配：英文单词、数字、连续的中文（2个或以上）
    const tokens: string[] = [];

    // 正则表达式模式：
    // - 英文单词/数字：[a-zA-Z0-9]+
    // - 中文词语（2字以上）：[\u4e00-\u9fa5]{2,}
    const pattern = /[a-zA-Z0-9]+|[\u4e00-\u9fa5]{2,}/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const token = match[0];

      // 2. 过滤纯数字（如 "123", "2024"）
      if (/^\d+$/.test(token)) {
        continue;
      }

      // 3. 转换为小写（英文）
      const normalizedToken = token.toLowerCase();

      tokens.push(normalizedToken);
    }

    return tokens;
  }

  /**
   * 构建索引
   * @param documents 文档列表
   */
  index(documents: BM25Document[]): void {
    // 清空现有索引
    this.documents.clear();
    this.docVectors.clear();
    this.idfCache.clear();
    this.docLengths.clear();

    const N = documents.length;
    let totalLength = 0;

    // 1. 处理每个文档
    for (const doc of documents) {
      const tokens = this.tokenize(doc.content);
      const tokenFreq = new Map<string, number>();

      // 计算词频
      for (const token of tokens) {
        tokenFreq.set(token, (tokenFreq.get(token) || 0) + 1);
      }

      // 存储文档和词频向量
      this.documents.set(doc.id, doc.content);
      this.docVectors.set(doc.id, tokenFreq);
      this.docLengths.set(doc.id, tokens.length);
      totalLength += tokens.length;
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
    const queryTokens = this.tokenize(query);

    const results: Map<string, number> = new Map();

    // 对每个文档计算 BM25 分数
    for (const [docId, docVector] of this.docVectors.entries()) {
      const docLength = this.docLengths.get(docId) || 0;
      let score = 0;

      // BM25 公式：
      // score = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D| / avgDl))
      for (const token of queryTokens) {
        // 检查 token 是否在文档中
        const freq = docVector.get(token) || 0;
        if (freq === 0) continue;

        // 获取 IDF
        const idf = this.idfCache.get(token) || 0;

        // 计算 BM25 分数分量
        const numerator = freq * (this.k1 + 1);
        const denominator = freq + this.k1 * (1 - this.b + this.b * (docLength / this.averageDocLength));
        const componentScore = idf * (numerator / denominator);

        score += componentScore;
      }

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

  /**
   * 更新单个文档
   * @param document 要更新的文档
   */
  update(document: BM25Document): void {
    // 如果文档已存在，先删除
    if (this.documents.has(document.id)) {
      this.delete(document.id);
    }

    // 添加新文档
    this.index([document]);
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

/**
 * 全局 BM25 索引实例
 */
let globalBM25Index: BM25Index | null = null;

/**
 * 初始化全局 BM25 索引
 * @param documents 文档列表
 */
export function initBM25Index(documents: BM25Document[]): BM25Index {
  if (!globalBM25Index) {
    globalBM25Index = new BM25Index();
  }
  globalBM25Index.index(documents);
  return globalBM25Index;
}

/**
 * 获取全局 BM25 索引
 */
export function getBM25Index(): BM25Index | null {
  return globalBM25Index;
}

/**
 * 清空全局 BM25 索引
 */
export function clearBM25Index(): void {
  if (globalBM25Index) {
    globalBM25Index.clear();
    globalBM25Index = null;
  }
}
