import { invalidateMemoryCache } from '@/lib/memory/cache-version'
import { enqueueAutoDataSync } from '@/lib/sync/auto-data-sync-queue'
import { getDb } from './index'

export interface MemoryPolicy {
  useMemories: boolean
  generateMemories: boolean
  excludeExternalContext: boolean
  generationStartedAt: number
  updatedAt: number
}

let memoryPolicySchemaPromise: Promise<void> | undefined

export async function initMemoryPolicyDb() {
  if (!memoryPolicySchemaPromise) {
    memoryPolicySchemaPromise = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists memory_global_policy (
          id integer primary key check(id = 1),
          use_memories integer not null,
          generate_memories integer not null,
          exclude_external_context integer not null,
          generation_started_at integer not null default 0,
          defaults_version integer not null default 0,
          updated_at integer not null
        )
      `)
      try {
        await db.execute(
          'alter table memory_global_policy add column generation_started_at integer not null default 0'
        )
      } catch {
        // Idempotent migration: SQLite throws when a column already exists.
      }
      try {
        await db.execute(
          'alter table memory_global_policy add column defaults_version integer not null default 0'
        )
      } catch {
        // Idempotent migration: SQLite throws when a column already exists.
      }

      const policy = await db.select<Array<{ id: number }>>(
        'select id from memory_global_policy where id = 1',
        []
      )
      const now = Date.now()
      if (policy.length === 0) {
        await db.execute(
          `insert into memory_global_policy
           (id, use_memories, generate_memories, exclude_external_context,
            generation_started_at, defaults_version, updated_at)
           values (1, 1, 1, 1, $1, 1, $1)`,
          [now]
        )
      } else {
        await db.execute(
          `update memory_global_policy
           set use_memories = 1,
               generate_memories = 1,
               generation_started_at = $1,
               defaults_version = 1,
               updated_at = $1
           where defaults_version < 1`,
          [now]
        )
      }
    })().catch((error) => {
      memoryPolicySchemaPromise = undefined
      throw error
    })
  }
  await memoryPolicySchemaPromise
}

export async function getMemoryPolicy(): Promise<MemoryPolicy> {
  await initMemoryPolicyDb()
  const db = await getDb()
  const result = await db.select<Array<{
    generateMemories: number
    generationStartedAt: number
    updatedAt: number
  }>>(
    `select
      generate_memories as generateMemories,
      generation_started_at as generationStartedAt,
      updated_at as updatedAt
     from memory_global_policy where id = 1`,
    []
  )
  return {
    useMemories: true,
    generateMemories: result[0]?.generateMemories !== 0,
    excludeExternalContext: true,
    generationStartedAt: result[0]?.generationStartedAt || Date.now(),
    updatedAt: result[0]?.updatedAt || Date.now(),
  }
}

export async function updateMemoryPolicy(
  policy: Partial<MemoryPolicy>
): Promise<MemoryPolicy> {
  const current = await getMemoryPolicy()
  const generateMemories = policy.generateMemories ?? current.generateMemories
  const updatedAt = Date.now()
  const next: MemoryPolicy = {
    useMemories: true,
    generateMemories,
    excludeExternalContext: true,
    generationStartedAt: !current.generateMemories && generateMemories
      ? Date.now()
      : current.generationStartedAt,
    updatedAt,
  }
  const db = await getDb()
  await db.execute(
    `update memory_global_policy
     set use_memories = 1,
         generate_memories = $1,
         exclude_external_context = 1,
         generation_started_at = $2,
         updated_at = $3
     where id = 1`,
    [
      next.generateMemories ? 1 : 0,
      next.generationStartedAt,
      updatedAt,
    ]
  )
  invalidateMemoryCache()
  enqueueAutoDataSync('settings', 'memory-policy:update')
  return next
}

export async function replaceMemoryPolicy(policy: MemoryPolicy): Promise<void> {
  await initMemoryPolicyDb()
  const db = await getDb()
  await db.execute(
    `update memory_global_policy
     set use_memories = 1,
         generate_memories = $1,
         exclude_external_context = 1,
         generation_started_at = $2,
         updated_at = $3
     where id = 1`,
    [
      policy.generateMemories ? 1 : 0,
      policy.generationStartedAt,
      policy.updatedAt,
    ]
  )
  invalidateMemoryCache()
}
