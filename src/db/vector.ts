import { invoke } from '@tauri-apps/api/core';
import { db, executeRecordTransaction, getDb } from './index';
import { clearWorkspaceBM25Index, getWorkspaceBM25Stats, invalidateWorkspaceBM25 } from '@/lib/bm25-workspace-index';
import { createKnowledgeSourceKey, parseKnowledgeSourceKey } from '@/types/knowledge';

export function normalizeVectorDocumentKey(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  return parseKnowledgeSourceKey(normalized)
    ? normalized
    : createKnowledgeSourceKey('article', normalized);
}

// 向量数据库表结构定义
export interface VectorDocument {
  id: number;
  filename: string;   // 文件名
  chunk_id: number;   // 分块ID
  content: string;    // 分块内容
  embedding: string;  // 存储为JSON字符串的向量
  updated_at: number; // 时间戳
}

export type VectorDocumentSnapshot = Omit<VectorDocument, 'id'>;

export interface VectorIndexStats {
  documentCount: number;
  chunkCount: number;
  bm25DocumentCount: number;
  bm25ChunkCount: number;
  lastUpdatedAt: number | null;
}

export interface VectorIndexSummary {
  filename: string;
  updated_at: number;
}

// 初始化向量数据库表
type VectorDatabase = Awaited<ReturnType<typeof getDb>>;
const schemaByConnection = new WeakMap<VectorDatabase, Promise<void>>();

async function initializeVectorSchema(connection: VectorDatabase) {
  await connection.execute(`
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
  await connection.execute(`
    create index if not exists idx_vector_documents_filename
    on vector_documents(filename)
  `);

  // 旧版仅存 Markdown 路径。增加 article: 前缀即可完成来源迁移，
  // 向量本身不变，因此不会产生新的 Embedding 请求。
  await connection.execute(`
    update vector_documents
    set filename = 'article:' || filename
    where filename not like 'article:%'
      and filename not like 'record:%'
      and filename not like 'canvas:%'
  `);
}

export async function initVectorDb() {
  const connection = await getDb();
  let schema = schemaByConnection.get(connection);
  if (!schema) {
    schema = initializeVectorSchema(connection).catch(error => {
      schemaByConnection.delete(connection);
      throw error;
    });
    schemaByConnection.set(connection, schema);
  }
  await schema;
}

export async function getAllVectorDocuments(): Promise<VectorDocumentSnapshot[]> {
  return await db.select<VectorDocumentSnapshot[]>(`
    select filename, chunk_id, content, embedding, updated_at
    from vector_documents
    order by filename, chunk_id
  `);
}

export async function getVectorIndexSummaries(): Promise<VectorIndexSummary[]> {
  return await db.select<VectorIndexSummary[]>(`
    select filename, max(updated_at) as updated_at
    from vector_documents
    group by filename
  `);
}

export async function getVectorIndexStats(): Promise<VectorIndexStats> {
  const rows = await db.select<Array<{
    document_count: number;
    chunk_count: number;
    last_updated_at: number | null;
  }>>(`
    select
      count(distinct filename) as document_count,
      count(*) as chunk_count,
      max(updated_at) as last_updated_at
    from vector_documents
  `);
  const bm25Stats = await getWorkspaceBM25Stats();
  return {
    documentCount: Number(rows[0]?.document_count || 0),
    chunkCount: Number(rows[0]?.chunk_count || 0),
    bm25DocumentCount: bm25Stats.documentCount,
    bm25ChunkCount: bm25Stats.chunkCount,
    lastUpdatedAt: rows[0]?.last_updated_at ? Number(rows[0].last_updated_at) : null
  };
}

function insertVectorStatements(documents: VectorDocumentSnapshot[], filename?: string) {
  return documents.map(document => ({
    sql: 'insert into vector_documents (filename, chunk_id, content, embedding, updated_at) values ($1, $2, $3, $4, $5)',
    values: [filename ?? normalizeVectorDocumentKey(document.filename), document.chunk_id,
      document.content, document.embedding, document.updated_at],
  }));
}

export async function replaceAllVectorDocuments(documents: VectorDocumentSnapshot[]): Promise<void> {
  await executeRecordTransaction([
    { sql: 'delete from vector_documents', values: [] },
    ...insertVectorStatements(documents),
  ]);
}

export async function replaceVectorDocumentsByFilename(
  filename: string,
  documents: VectorDocumentSnapshot[]
): Promise<void> {
  const key = normalizeVectorDocumentKey(filename);
  await executeRecordTransaction([
    { sql: 'delete from vector_documents where filename = $1', values: [key] },
    ...insertVectorStatements(documents, key),
  ]);
}

// 插入或更新向量文档
export async function upsertVectorDocument(doc: Omit<VectorDocument, 'id'>) {
  const filename = normalizeVectorDocumentKey(doc.filename);
  await db.execute(
    "insert into vector_documents (filename, chunk_id, content, embedding, updated_at) values ($1, $2, $3, $4, $5) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at",
    [filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at]);
}

// 获取指定文件名的所有向量文档
export async function getVectorDocumentsByFilename(filename: string) {
  const normalizedFilename = normalizeVectorDocumentKey(filename);
  return await db.select<VectorDocument[]>(
    "select * from vector_documents where filename = $1 order by chunk_id",
    [normalizedFilename]);
}

/** Aggregate only this folder's known notes without loading embedding payloads. */
export async function getVectorIndexStatsForFiles(filenames: readonly string[]): Promise<{
  documentCount: number;
  chunkCount: number;
  lastUpdatedAt: number | null;
}> {
  const keys = [...new Set(filenames.map(normalizeVectorDocumentKey))];
  const summary = { documentCount: 0, chunkCount: 0, lastUpdatedAt: null as number | null };
  for (let offset = 0; offset < keys.length; offset += 200) {
    const batch = keys.slice(offset, offset + 200);
    const placeholders = batch.map((_, index) => `$${index + 1}`).join(',');
    const rows = await db.select<Array<{ documentCount: number; chunkCount: number; lastUpdatedAt: number | null }>>(
      `select count(distinct filename) as documentCount,count(*) as chunkCount,max(updated_at) as lastUpdatedAt
       from vector_documents where filename in (${placeholders})`, batch);
    const result = rows[0];
    if (!result) continue;
    summary.documentCount += Number(result.documentCount) || 0;
    summary.chunkCount += Number(result.chunkCount) || 0;
    if (result.lastUpdatedAt !== null) summary.lastUpdatedAt = Math.max(summary.lastUpdatedAt ?? 0, Number(result.lastUpdatedAt));
  }
  return summary;
}

// 通过文件名删除向量文档
export async function deleteVectorDocumentsByFilename(filename: string) {
  const normalizedFilename = normalizeVectorDocumentKey(filename);
  await db.execute(
    "delete from vector_documents where filename = $1",
    [normalizedFilename]);

  invalidateWorkspaceBM25(normalizedFilename);
}

export async function renameVectorDocumentsByFilename(oldFilename: string, newFilename: string) {
  const normalizedOldFilename = normalizeVectorDocumentKey(oldFilename);
  const normalizedNewFilename = normalizeVectorDocumentKey(newFilename);
  if (normalizedOldFilename === normalizedNewFilename) return;
  await executeRecordTransaction([
    { sql: 'delete from vector_documents where filename = $1', values: [normalizedNewFilename] },
    { sql: 'update vector_documents set filename = $1, updated_at = $2 where filename = $3',
      values: [normalizedNewFilename, Date.now(), normalizedOldFilename] },
  ]);
  invalidateWorkspaceBM25(normalizedOldFilename);
  invalidateWorkspaceBM25(normalizedNewFilename);
}

export async function deleteVectorDocumentsByPrefix(prefix: string) {
  const normalizedPrefix = normalizeVectorDocumentKey(prefix);
  await db.execute(
    'delete from vector_documents where filename = $1 or filename like $2',
    [normalizedPrefix, `${normalizedPrefix}/%`]
  );
  invalidateWorkspaceBM25(normalizedPrefix);
}

export async function renameVectorDocumentsByPrefix(oldPrefix: string, newPrefix: string) {
  const normalizedOldPrefix = normalizeVectorDocumentKey(oldPrefix);
  const normalizedNewPrefix = normalizeVectorDocumentKey(newPrefix);
  if (normalizedOldPrefix === normalizedNewPrefix) return;
  const filenames = await db.select<{ filename: string }[]>(
    'select distinct filename from vector_documents where filename = $1 or filename like $2',
    [normalizedOldPrefix, `${normalizedOldPrefix}/%`]
  );
  for (const { filename } of filenames) {
    const suffix = filename.slice(normalizedOldPrefix.length);
    const nextFilename = `${normalizedNewPrefix}${suffix}`;
    await db.execute('delete from vector_documents where filename = $1', [nextFilename]);
    await db.execute(
      'update vector_documents set filename = $1, updated_at = $2 where filename = $3',
      [nextFilename, Date.now(), filename]
    );
  }
  invalidateWorkspaceBM25(normalizedOldPrefix);
  invalidateWorkspaceBM25(normalizedNewPrefix);
}

// 检查文件是否已存在于向量数据库中
export async function checkVectorDocumentExists(filename: string) {
  const normalizedFilename = normalizeVectorDocumentKey(filename);
  const result = await db.select<{ count: number }[]>(
    "select count(*) as count from vector_documents where filename = $1",
    [normalizedFilename]);
  
  return result[0]?.count > 0;
}

interface SimilarVectorDocument {
  id: number;
  filename: string;
  chunk_id: number;
  content: string;
  similarity: number;
}

export async function getSimilarDocuments(
  queryEmbedding: number[],
  limit: number = 5,
  threshold: number = 0.7,
  allowedFilenames?: ReadonlySet<string>
): Promise<SimilarVectorDocument[]> {
  if (limit <= 0 || allowedFilenames?.size === 0) return [];
  await initVectorDb();
  return invoke<SimilarVectorDocument[]>('search_vector_documents', {
    queryEmbedding, limit, threshold, filenames: allowedFilenames ? Array.from(allowedFilenames) : null,
  });
}

// 清空向量数据库
export async function clearVectorDb() {
  await db.execute(`
    delete from vector_documents
  `);

  await clearWorkspaceBM25Index();
}

// 获取所有向量文档的文件名列表
export async function getAllVectorDocumentFilenames() {
  return await db.select<{filename: string}[]>(`
    select distinct filename from vector_documents
  `);
}
