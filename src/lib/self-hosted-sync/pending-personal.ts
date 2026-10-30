import { getDb } from '@/db'
import { decryptPackedJson, loadWorkspaceKey, objectAssociatedData } from './crypto'
import type { SyncEvent } from './protocol'

interface Context { workspaceId: string; workspaceType: 'account-data' | 'library' }
interface Targets {
  objectIds: Set<string>
  identities: Set<string>
  parentIds: Set<string>
  domain: string | undefined
}
interface Change { id: number; domain: string; localKey: string; state: string; operation: 'upsert' | 'delete' }
interface Command {
  payload: string
  objectId: string | null
  sourceIds: string
  restoreLocalSnapshot: number
}
const record = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
)

/** Describe only rows this object can replace, or this parent deletion can affect. */
async function mutationTargets(context: Context, event: SyncEvent, payload?: Record<string, unknown>): Promise<Targets> {
  const database = await getDb()
  const mappings = await database.select<Array<{ kind: string; localIdentity: string }>>(
    `select kind, local_identity as localIdentity from self_hosted_object_mappings
     where workspace_id = $1 and object_id = $2 limit 1`, [context.workspaceId, event.objectId],
  )
  const mapping = mappings[0]
  const kind = typeof event.metadata.kind === 'string' ? event.metadata.kind : mapping?.kind
  const domain = typeof payload?.domain === 'string' ? payload.domain : kind === 'note' ? 'mark' : kind
  const aliases = new Map<string, Set<string>>()
  const owned = new Map<string, Set<string>>()
  const add = (targetDomain: string, key: unknown, ownedKey = false) => {
    if ((typeof key !== 'string' || !key) && typeof key !== 'number') return
    const keys = aliases.get(targetDomain) ?? new Set<string>()
    keys.add(String(key)); aliases.set(targetDomain, keys)
    if (ownedKey) {
      const local = owned.get(targetDomain) ?? new Set<string>()
      local.add(String(key)); owned.set(targetDomain, local)
    }
  }
  if (domain && mapping?.localIdentity.startsWith(`${domain}:`)) {
    add(domain, mapping.localIdentity.slice(domain.length + 1), true)
  }
  const value = record(payload?.value)
  if (domain === 'mark' && payload) add(domain, value.sourceId || event.objectId)
  else if (domain === 'conversation' || domain === 'message') add(domain, value.syncId ?? payload?.localKey)
  else if (domain === 'canvas' || domain === 'memory') add(domain, value.id ?? payload?.localKey)
  else if (domain === 'setting') add(domain, 'all')

  const expand = async (targetDomain: 'mark' | 'message' | 'conversation') => {
    const table = targetDomain === 'mark' ? 'marks' : targetDomain === 'message' ? 'chats' : 'conversations'
    const stable = targetDomain === 'mark' ? 'sourceId' : 'syncId'
    const rows = await database.select<Array<{ id: string; stableId: string | null }>>(
      `select cast(id as text) as id, ${stable} as stableId from ${table}
       where ${stable} in (select value from json_each($1))
         or cast(id as text) in (select value from json_each($2))`,
      [JSON.stringify([...(aliases.get(targetDomain) ?? [])]), JSON.stringify([...(owned.get(targetDomain) ?? [])])],
    )
    for (const row of rows) { add(targetDomain, row.id, true); add(targetDomain, row.stableId) }
  }
  if (domain === 'mark' || domain === 'message' || domain === 'conversation') await expand(domain)

  const cascade = event.type === 'object.deleted' && (domain === 'tag' || domain === 'conversation')
    && (owned.get(domain)?.size ?? 0) > 0
  if (cascade) {
    const parentKeys = JSON.stringify([...(owned.get(domain!) ?? [])])
    if (domain === 'tag') {
      const marks = await database.select<Array<{ id: string; stableId: string | null }>>(
        `select cast(m.id as text) as id, m.sourceId as stableId from marks m
         where m.tagId in (select value from json_each($1)) or exists (
           select 1 from record_tag_metadata metadata, json_each(metadata.tagIds) tag
           where metadata.markId = m.id and tag.value in (select value from json_each($1)))`, [parentKeys],
      )
      for (const mark of marks) { add('mark', mark.id, true); add('mark', mark.stableId) }
    }
    const messages = await database.select<Array<{ id: string; stableId: string | null }>>(
      `select cast(id as text) as id, syncId as stableId from chats
       where ${domain === 'tag' ? 'tagId' : 'conversationId'} in (select value from json_each($1))`, [parentKeys],
    )
    for (const message of messages) { add('message', message.id, true); add('message', message.stableId) }
  }
  const identities = new Set([...aliases].flatMap(([targetDomain, keys]) => [...keys].map(key => `${targetDomain}:${key}`)))
  const owners = await database.select<Array<{ objectId: string; kind: string }>>(
    `select object_id as objectId, kind from self_hosted_object_mappings
     where workspace_id = $1 and local_identity in (select value from json_each($2))`,
    [context.workspaceId, JSON.stringify([...identities])],
  )
  const objectIds = new Set([event.objectId!, ...owners.map(owner => owner.objectId)])
  const parentIds = cascade ? new Set([event.objectId!, ...owners.filter(owner => owner.kind === domain).map(owner => owner.objectId)]) : new Set<string>()
  return { objectIds, identities, parentIds, domain }
}

async function targetChanges(context: Context, targets: Targets) {
  return (await getDb()).select<Change[]>(
    `select id, domain, local_key as localKey, state, operation from self_hosted_local_changes
     where state in ('pending', 'queued') and (workspace_id = $1 or workspace_id is null)
       and ((domain || ':' || local_key) in (select value from json_each($2))
         or ($3 = 'setting' and domain = 'setting'))`,
    [context.workspaceId, JSON.stringify([...targets.identities]), targets.domain ?? null],
  )
}

export async function pendingPersonalChangesForEvent(context: Context, event: SyncEvent, payload: Record<string, unknown>, includeQueued = false) {
  if (context.workspaceType !== 'account-data' || !event.objectId) return [] as Change[]
  return (await targetChanges(context, await mutationTargets(context, event, payload)))
    .filter(change => includeQueued || change.state === 'pending')
}

/** A failed attachment elsewhere in the workspace must not guard this object's rows. */
export async function hasPendingPersonalMutation(
  context: Context, event: SyncEvent, payload?: Record<string, unknown>, allowRestoredSnapshots = false,
) {
  if (context.workspaceType !== 'account-data' || !event.objectId) return false
  const targets = await mutationTargets(context, event, payload)
  const database = await getDb()
  const commands = await database.select<Command[]>(
    `select payload, source_change_ids as sourceIds, restore_local_snapshot as restoreLocalSnapshot,
       coalesce(json_extract(payload, '$.objectId'), json_extract(payload, '$.objectResolution.objectId'),
         json_extract(payload, '$.resolution.objectId'),
         (select object_id from self_hosted_conflicts where workspace_id = $1
           and id = json_extract(o.payload, '$.conflictId') limit 1)) as objectId
     from self_hosted_outbox o where workspace_id = $1 and state in ('pending', 'retry', 'blocked')`,
    [context.workspaceId],
  )
  const savedSources = new Set<number>()
  for (const row of commands) {
    const command = record(JSON.parse(row.payload))
    if (row.objectId && targets.objectIds.has(row.objectId)) {
      if (allowRestoredSnapshots && row.restoreLocalSnapshot === 1 && command.type === 'upsert-object'
        && row.objectId === event.objectId) {
        const sourceIds = JSON.parse(row.sourceIds) as number[]
        if (sourceIds.length && sourceIds.every(id => Number.isSafeInteger(id) && id > 0)) {
          for (const id of sourceIds) savedSources.add(id)
          continue
        }
      }
      return true
    }
    if (!targets.parentIds.size) continue
    // A frozen child can still refer to this parent after its local row moved.
    // Inspect that command's authenticated references rather than pausing every
    // pending command in the account workspace.
    const envelope = typeof command.ciphertext === 'string' ? command
      : typeof record(command.objectResolution).ciphertext === 'string' ? record(command.objectResolution) : record(command.resolution)
    const objectId = typeof envelope.objectId === 'string' ? envelope.objectId : row.objectId
    if (!objectId || typeof envelope.kind !== 'string' || typeof envelope.keyVersion !== 'number'
      || typeof envelope.ciphertext !== 'string' || !['mark', 'message'].includes(envelope.kind)) continue
    const frozen = await decryptPackedJson<Record<string, unknown>>(
      await loadWorkspaceKey(context.workspaceId, envelope.keyVersion), envelope.ciphertext,
      objectAssociatedData(context.workspaceId, objectId, envelope.kind),
    )
    if (Object.values(record(frozen.references)).some(reference => typeof reference === 'string' && targets.parentIds.has(reference))) return true
  }
  const changes = await targetChanges(context, targets)
  return changes.some(change => change.state !== 'queued' || !savedSources.has(change.id))
}
