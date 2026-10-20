
import Database, { type QueryResult } from '@tauri-apps/plugin-sql'
import { invoke } from '@tauri-apps/api/core'

export interface RecordStatement {
  sql: string
  values: (string | number | boolean | null)[]
  expectedRows?: number
}

export async function executeRecordTransaction(statements: RecordStatement[]) {
  await getDb()
  await invoke('execute_record_transaction', { statements })
}

let database: Database | null = null
let databaseLoading: Promise<Database> | null = null

async function loadDatabase(): Promise<Database> {
  if (typeof window === 'undefined') {
    throw new Error('The local database is only available in the Tauri client runtime')
  }

  const nextDatabase = await Database.load('sqlite:note.db')

  // Core schema migrations must finish before callers receive the connection.
  // Altering the table later can invalidate SQLx's cached `select *` metadata on
  // a concurrent query.
  await nextDatabase.execute(`
    create table if not exists marks (
      id integer primary key autoincrement,
      tagId integer not null,
      type text not null,
      content text default null,
      url text default null,
      desc text default null,
      deleted integer default 0,
      createdAt integer,
      sourceId text default null
    )
  `)
  try {
    await nextDatabase.select('select sourceId from marks limit 1')
  } catch {
    await nextDatabase.execute('alter table marks add column sourceId text default null')
  }
  await nextDatabase.execute(
    'create unique index if not exists idx_marks_source_id on marks(sourceId) where sourceId is not null'
  )
  await nextDatabase.execute(`
    create table if not exists record_tag_metadata (
      markId integer primary key,
      tagIds text not null,
      updatedAt integer not null default 0
    )
  `)
  const tagMetadataColumns = await nextDatabase.select<Array<{ name: string }>>('pragma table_info(record_tag_metadata)')
  if (!tagMetadataColumns.some(column => column.name === 'updatedAt')) {
    await nextDatabase.execute('alter table record_tag_metadata add column updatedAt integer not null default 0')
  }
  // Keep legacy writers (plugins, older clients and structured sync) compatible.
  // A primary-tag move replaces only that tag; all additional tags survive.
  await nextDatabase.execute(`
    create trigger if not exists record_tags_move after update of tagId on marks
    when OLD.tagId != NEW.tagId
    begin
      update record_tag_metadata set tagIds = (
        select json_group_array(value) from (
          select cast(value as integer) as value from json_each(tagIds) where value != OLD.tagId
          union select NEW.tagId
        )
      ), updatedAt = cast((julianday('now') - 2440587.5) * 86400000 as integer) where markId = NEW.id;
      insert or ignore into record_tag_metadata (markId, tagIds, updatedAt)
      values (NEW.id, json_array(NEW.tagId), cast((julianday('now') - 2440587.5) * 86400000 as integer));
    end
  `)
  await nextDatabase.execute(`
    create trigger if not exists record_tags_delete after delete on marks
    begin delete from record_tag_metadata where markId = OLD.id; end
  `)
  for (const operation of ['insert', 'update'] as const) {
    await nextDatabase.execute(`
      create trigger if not exists record_tags_${operation} after ${operation} on record_tag_metadata
      begin update marks set sourceId = sourceId where id = NEW.markId; end
    `)
  }

  return nextDatabase
}

// Loading must stay behind a function boundary. Next.js may evaluate client
// module dependencies while rendering on the server, where the Tauri bridge and
// `window` do not exist.
export async function getDb(): Promise<Database> {
  if (database) return database

  if (!databaseLoading) {
    databaseLoading = loadDatabase()
      .then((nextDatabase) => {
        database = nextDatabase
        return nextDatabase
      })
      .catch((error) => {
        databaseLoading = null
        throw error
      })
  }

  return databaseLoading
}

// Compatibility facade for modules that historically imported `db` directly.
// Every method resolves the client-only connection lazily.
export const db = {
  async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
    return (await getDb()).execute(query, bindValues)
  },
  async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    return (await getDb()).select<T>(query, bindValues)
  },
  async close(databaseName?: string): Promise<boolean> {
    const activeDatabase = await getDb()
    try {
      return await activeDatabase.close(databaseName)
    } finally {
      database = null
      databaseLoading = null
      databaseInitialization = null
    }
  },
}

let databaseInitialization: Promise<void> | null = null

async function initializeAllDatabases() {
  // 引入各数据库初始化函数
  const { initChatsDb } = await import('./chats');
  const { initMarksDb } = await import('./marks');
  const { initNotesDb } = await import('./notes');
  const { initTagsDb } = await import('./tags');
  const { initVectorDb } = await import('./vector');
  const { initConversationsDb } = await import('./conversations');
  const { initMemoriesDb } = await import('./memories');
  const { initActivityDb } = await import('./activity');
  const { initCanvasesDb } = await import('./canvases');
  const { initConversationCompactionsDb } = await import('./conversation-compactions');
  const { initConversationSyncStateDb } = await import('./conversation-sync-state');
  const { initImageAnalysisCacheDb } = await import('./image-analysis-cache');
  const { initKnowledgeDb } = await import('./knowledge');
  const { initSelfHostedSyncDb } = await import('./self-hosted-sync');

  // 执行初始化：先确保基础表存在，再做 conversations 对 chats 的迁移/补列。
  await initChatsDb();
  await initConversationsDb();
  await initConversationCompactionsDb();
  await initConversationSyncStateDb();
  await initImageAnalysisCacheDb();
  await initMarksDb();
  await initNotesDb();
  await initTagsDb();
  await initVectorDb();
  await initMemoriesDb();
  await initCanvasesDb();
  await initActivityDb();
  await initKnowledgeDb();
  await initSelfHostedSyncDb();
  const { bootstrapStructuredKnowledgeRegistry } = await import('@/lib/knowledge-index');
  await bootstrapStructuredKnowledgeRegistry();

  const { Store } = await import('@tauri-apps/plugin-store')
  const store = await Store.load('store.json')
  if (await store.get<boolean>('conversationSyncInitialized') === undefined) {
    await store.set('conversationSyncInitialized', true)
    await store.save()
    const { enqueueAutoDataSync } = await import('@/lib/sync/auto-data-sync-queue')
    enqueueAutoDataSync('conversations', 'conversations-sync-initialized')
  }
}

// 初始化所有数据库。同一进程内复用初始化任务，避免多个页面入口并发执行迁移。
export function initAllDatabases(): Promise<void> {
  if (!databaseInitialization) {
    databaseInitialization = initializeAllDatabases().catch((error) => {
      databaseInitialization = null
      throw error
    })
  }

  return databaseInitialization
}
