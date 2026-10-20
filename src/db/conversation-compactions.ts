import { getDb } from './index'
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import { nextConversationSyncTimestamp } from './conversation-sync-state'

export interface ConversationCompaction {
  id: number
  conversationId: number
  summary: string
  coveredThroughChatId: number
  tailStartChatId?: number
  sourceTokenCount: number
  summaryTokenCount: number
  model: string
  promptVersion: number
  retainedTurnCount: number
  prunedToolResultCount: number
  prunedToolTokenCount: number
  revision: number
  createdAt: number
}

export type NewConversationCompaction = Omit<ConversationCompaction, 'id' | 'createdAt' | 'revision'>

export async function initConversationCompactionsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists conversation_compactions (
      id integer primary key autoincrement,
      conversationId integer not null,
      summary text not null,
      coveredThroughChatId integer not null,
      tailStartChatId integer default null,
      sourceTokenCount integer not null,
      summaryTokenCount integer not null,
      model text not null,
      promptVersion integer not null,
      revision integer not null,
      createdAt integer not null
    )
  `)
  for (const column of [
    'retainedTurnCount integer not null default 0',
    'prunedToolResultCount integer not null default 0',
    'prunedToolTokenCount integer not null default 0',
  ]) {
    try {
      await db.execute(`alter table conversation_compactions add column ${column}`)
    } catch {
      // Idempotent migration.
    }
  }
  await db.execute(`
    create index if not exists idx_conversation_compactions_latest
    on conversation_compactions(conversationId, revision desc)
  `)
}

export async function getLatestConversationCompaction(
  conversationId: number
): Promise<ConversationCompaction | null> {
  const db = await getDb()
  const result = await db.select<ConversationCompaction[]>(
    `select
       id,
       conversationId,
       summary,
       coveredThroughChatId,
       tailStartChatId,
       sourceTokenCount,
       summaryTokenCount,
       model,
       promptVersion,
       coalesce(retainedTurnCount, 0) as retainedTurnCount,
       coalesce(prunedToolResultCount, 0) as prunedToolResultCount,
       coalesce(prunedToolTokenCount, 0) as prunedToolTokenCount,
       revision,
       createdAt
     from conversation_compactions
     where conversationId = $1
     order by revision desc
     limit 1`,
    [conversationId]
  )
  return result[0] || null
}

export async function insertConversationCompaction(compaction: NewConversationCompaction) {
  const db = await getDb()
  const latest = await getLatestConversationCompaction(compaction.conversationId)
  const revision = (latest?.revision || 0) + 1
  const createdAt = await nextConversationSyncTimestamp()
  const result = await db.execute(
    `insert into conversation_compactions (
      conversationId,
      summary,
      coveredThroughChatId,
      tailStartChatId,
      sourceTokenCount,
      summaryTokenCount,
      model,
      promptVersion,
      retainedTurnCount,
      prunedToolResultCount,
      prunedToolTokenCount,
      revision,
      createdAt
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      compaction.conversationId,
      compaction.summary,
      compaction.coveredThroughChatId,
      compaction.tailStartChatId,
      compaction.sourceTokenCount,
      compaction.summaryTokenCount,
      compaction.model,
      compaction.promptVersion,
      compaction.retainedTurnCount,
      compaction.prunedToolResultCount,
      compaction.prunedToolTokenCount,
      revision,
      createdAt,
    ]
  )
  await db.execute(
    'update conversations set syncUpdatedAt = $1 where id = $2',
    [createdAt, compaction.conversationId]
  )

  enqueueAutoDataSync('conversations', 'conversation-compaction-created')

  return {
    ...compaction,
    id: result.lastInsertId as number,
    revision,
    createdAt,
  } satisfies ConversationCompaction
}

export async function deleteConversationCompactions(conversationId: number) {
  const db = await getDb()
  const syncUpdatedAt = await nextConversationSyncTimestamp()
  await db.execute(
    'delete from conversation_compactions where conversationId = $1',
    [conversationId]
  )
  await db.execute(
    'update conversations set syncUpdatedAt = $1 where id = $2',
    [syncUpdatedAt, conversationId]
  )
  enqueueAutoDataSync('conversations', 'conversation-compaction-deleted')
}

export async function deleteAllConversationCompactions() {
  const db = await getDb()
  await db.execute('delete from conversation_compactions', [])
}
