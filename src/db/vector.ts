import { db } from './index';

// 向量数据库表结构定义
export interface VectorDocument {
  id: number;
  filename: string;   // 文件名
  chunk_id: number;   // 分块ID
  content: string;    // 分块内容
  embedding: string;  // 存储为JSON字符串的向量
  updated_at: number; // 时间戳
}

// 初始化向量数据库表
export async function initVectorDb() {
  await db.execute(`
    create table if not exists vector_documents (
      id integer primary key autoincrement,
      filename text not null,
      chunk_id integer not null,
      content text not null,
      embedding text not null,
      updated_at integer not null,
      unique(filename, chunk_id)
    )
  `);
  
  // 创建用于快速查找文件的索引
  await db.execute(`
    create index if not exists idx_vector_documents_filename 
    on vector_documents(filename)
  `);
}

// 插入或更新向量文档
export async function upsertVectorDocument(doc: Omit<VectorDocument, 'id'>) {
  await db.execute(`
    insert into vector_documents (filename, chunk_id, content, embedding, updated_at)
    values (?, ?, ?, ?, ?)
    on conflict(filename, chunk_id) do update set
    content = excluded.content,
    embedding = excluded.embedding,
    updated_at = excluded.updated_at
  `, [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at]);
}

// 获取指定文件名的所有向量文档
export async function getVectorDocumentsByFilename(filename: string) {
  return await db.select<VectorDocument[]>(`
    select * from vector_documents where filename = ? order by chunk_id
  `, [filename]);
}

// 通过文件名删除向量文档
export async function deleteVectorDocumentsByFilename(filename: string) {
  await db.execute(`
    delete from vector_documents where filename = ?
  `, [filename]);
}

// 检查文件是否已存在于向量数据库中
export async function checkVectorDocumentExists(filename: string) {
  const result = await db.select<{ count: number }[]>(`
    select count(*) as count from vector_documents where filename = ?
  `, [filename]);
  
  return result[0]?.count > 0;
}

// 获取最相似的文档片段
export async function getSimilarDocuments(
  queryEmbedding: number[], 
  limit: number = 5,
  threshold: number = 0.7
): Promise<{id: number, filename: string, content: string, similarity: number}[]> {
  // 获取所有文档向量
  const docs = await db.select<VectorDocument[]>(`
    select id, filename, content, embedding from vector_documents
  `);
  
  if (!docs.length) return [];
  
  // 计算余弦相似度并排序
  const results = docs.map(doc => {
    const docEmbedding = JSON.parse(doc.embedding) as number[];
    const similarity = cosineSimilarity(queryEmbedding, docEmbedding);
    
    return {
      id: doc.id,
      filename: doc.filename,
      content: doc.content,
      similarity
    };
  })
  .filter(doc => doc.similarity >= threshold)
  .sort((a, b) => b.similarity - a.similarity)
  .slice(0, limit);
  
  return results;
}

// 余弦相似度计算
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('向量维度不匹配');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 清空向量数据库
export async function clearVectorDb() {
  await db.execute(`
    delete from vector_documents
  `);
}

// 获取所有向量文档的文件名列表
export async function getAllVectorDocumentFilenames() {
  return await db.select<{filename: string}[]>(`
    select distinct filename from vector_documents
  `);
}
