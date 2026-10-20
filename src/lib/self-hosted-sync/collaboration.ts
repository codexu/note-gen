import { getDb } from '@/db'
import { invoke } from '@tauri-apps/api/core'
import { encryptJson, decryptPackedJson, loadWorkspaceKey, objectAssociatedData } from './crypto'
import { getSelfHostedSyncRuntime } from './runtime'
import { authenticatedClient } from './profile'
import { enqueueFileSnapshot } from './outbox'

interface DocumentBinding {
  workspaceId: string
  objectId: string
  documentId: string
  keyVersion: number
  kind: 'note' | 'canvas'
}

interface YjsEnvelope {
  format: 'yjs-v1'
  update: string
}

export type PresenceCoordinateSpace = 'markdown' | 'prosemirror'

export async function openCollaborativeDocument(localRoot: string, relativePath: string) {
  const binding = await resolveDocument(localRoot, relativePath)
  return openCollaborativeBinding(binding)
}

export async function openCollaborativeObject(
  workspaceId: string,
  objectId: string,
  documentId: string,
  kind: 'note' | 'canvas',
) {
  return openCollaborativeBinding({
    workspaceId, objectId, documentId, kind, keyVersion: await latestKeyVersion(workspaceId),
  })
}

function openCollaborativeBinding(binding: DocumentBinding) {
  const runtime = getSelfHostedSyncRuntime()
  const presenceOwner = Symbol('collaboration-presence')
  const unsubscribeDocument = runtime.subscribeDocument(binding.workspaceId, binding.documentId)
  let consumedThrough = '0'
  return {
    ...binding,
    initialize: (update: Uint8Array) => initializeYjsDocument(binding, update),
    appendUpdate: (update: Uint8Array) => appendYjsUpdate(binding, update),
    checkpoint: (state: Uint8Array) => commitYjsCheckpoint(binding, state),
    flush: () => runtime.wake('collaboration-flush'),
    consume: async (apply: (update: Uint8Array, checkpoint: boolean) => void) => {
      let pullError: unknown = null
      try {
        await pullDocumentUpdates(binding)
      } catch (error) {
        pullError = error
      }
      consumedThrough = await consumeYjsUpdates(binding, apply, consumedThrough)
      if (pullError) throw pullError
    },
    updatePresence: (
      anchor: number,
      head: number,
      label: string,
      coordinateSpace: PresenceCoordinateSpace,
    ) => {
      runtime.updatePresence(
        binding.workspaceId,
        binding.documentId,
        anchor,
        head,
        label,
        coordinateSpace,
        presenceOwner,
      )
    },
    clearPresence: () => runtime.clearPresence(presenceOwner),
    updateCanvasPresence: (nodes: Array<{ id: string; x: number; y: number }>, label: string) => {
      runtime.updateCanvasPresence(
        binding.workspaceId,
        binding.documentId,
        nodes,
        label,
        presenceOwner,
      )
    },
    subscribePresence: (listener: (message: Record<string, unknown>) => void) => runtime.subscribeRealtime(message => {
      if (message.workspaceId === binding.workspaceId
        && (message.documentId === binding.documentId || message.type === 'workspace.changed'
          || message.type === 'inbox.applied')) listener(message)
    }),
    close: () => {
      unsubscribeDocument()
      runtime.clearPresence(presenceOwner)
    },
  }
}

async function initializeYjsDocument(binding: DocumentBinding, update: Uint8Array) {
  const database = await getDb()
  const bindings = await database.select<Array<{ profileId: string; syncEpoch: string | null }>>(
    `select profile_id as profileId, sync_epoch as syncEpoch
     from self_hosted_workspace_bindings where workspace_id = $1 and binding_state = 'bound' limit 1`,
    [binding.workspaceId],
  )
  const localBinding = bindings[0]
  if (!localBinding?.syncEpoch) {
    throw new Error('自托管同步工作区尚未完成初始化')
  }

  const commandId = crypto.randomUUID()
  const updateId = crypto.randomUUID()
  const key = await loadWorkspaceKey(binding.workspaceId, binding.keyVersion)
  const encrypted = await encryptJson(key, {
    format: 'yjs-v1', update: bytesToBase64Url(update),
  } satisfies YjsEnvelope, objectAssociatedData(binding.workspaceId, binding.objectId, binding.kind))
  const { client } = await authenticatedClient(localBinding.profileId)
  const response = await client.pushCommands(binding.workspaceId, [{
    commandId,
    type: 'initialize-document',
    updateId,
    documentId: binding.documentId,
    objectId: binding.objectId,
    kind: binding.kind,
    keyVersion: binding.keyVersion,
    ciphertext: encrypted.packedCiphertext,
    ciphertextHash: encrypted.packedCiphertextHash,
  }], localBinding.syncEpoch)
  const result = response.results[0]
  if (result?.status === 'applied') return 'applied' as const
  if (result?.code === 'document_already_initialized') return 'already-initialized' as const
  throw new Error(`协作文档初始化失败：${result?.code ?? 'missing_command_result'}`)
}

async function pullDocumentUpdates(binding: DocumentBinding) {
  const database = await getDb()
  const bindings = await database.select<Array<{ profileId: string; syncEpoch: string | null }>>(
    `select profile_id as profileId, sync_epoch as syncEpoch
     from self_hosted_workspace_bindings where workspace_id = $1 and binding_state = 'bound' limit 1`,
    [binding.workspaceId],
  )
  const localBinding = bindings[0]
  if (!localBinding?.syncEpoch) return
  const sequences = await database.select<Array<{ sequence: string }>>(
    `select coalesce(max(cast(document_sequence as integer)), 0) as sequence
     from self_hosted_yjs_updates where workspace_id = $1 and document_id = $2`,
    [binding.workspaceId, binding.documentId],
  )
  let after = sequences[0]?.sequence ?? '0'
  let checkpointSequence = (await database.select<Array<{ sequence: string }>>(
    `select coalesce(max(cast(document_sequence as integer)), 0) as sequence
     from self_hosted_yjs_updates
     where workspace_id = $1 and document_id = $2 and event_type = 'checkpoint'`,
    [binding.workspaceId, binding.documentId],
  ))[0]?.sequence ?? '0'
  let hasMore = true
  const { client } = await authenticatedClient(localBinding.profileId)
  while (hasMore) {
    const page = await client.documentUpdates(
      binding.workspaceId,
      binding.documentId,
      after,
      localBinding.syncEpoch,
    )
    if (
      page.checkpoint
      && BigInt(page.checkpoint.documentSequence) > BigInt(checkpointSequence)
    ) {
      await database.execute(
        `insert or replace into self_hosted_yjs_updates(
           workspace_id, document_id, document_sequence, object_id, key_version,
           event_type, update_id, payload, applied, created_at
         ) values ($1, $2, $3, $4, $5, 'checkpoint', $6, $7, 0, $8)`,
        [
          binding.workspaceId,
          binding.documentId,
          page.checkpoint.documentSequence,
          page.checkpoint.objectId,
          page.checkpoint.keyVersion,
          page.checkpoint.checkpointId,
          page.checkpoint.ciphertext,
          Date.now(),
        ],
      )
      checkpointSequence = page.checkpoint.documentSequence
    }
    for (const update of page.updates) {
      await database.execute(
        `insert or ignore into self_hosted_yjs_updates(
           workspace_id, document_id, document_sequence, object_id, key_version,
           event_type, update_id, payload, applied, created_at
         ) values ($1, $2, $3, $4, $5, 'update', $6, $7, 0, $8)`,
        [
          binding.workspaceId,
          binding.documentId,
          update.documentSequence,
          binding.objectId,
          update.keyVersion,
          update.updateId,
          update.ciphertext,
          Date.now(),
        ],
      )
    }
    after = page.nextDocumentSequence
    hasMore = page.hasMore
  }
}

async function appendYjsUpdate(binding: DocumentBinding, update: Uint8Array) {
  const commandId = crypto.randomUUID()
  const updateId = crypto.randomUUID()
  const key = await loadWorkspaceKey(binding.workspaceId, binding.keyVersion)
  const encrypted = await encryptJson(key, {
    format: 'yjs-v1', update: bytesToBase64Url(update),
  } satisfies YjsEnvelope, objectAssociatedData(binding.workspaceId, binding.objectId, binding.kind))
  await insertCommand(binding.workspaceId, commandId, 'append-update', {
    commandId,
    type: 'append-update',
    updateId,
    documentId: binding.documentId,
    objectId: binding.objectId,
    kind: binding.kind,
    keyVersion: binding.keyVersion,
    ciphertext: encrypted.packedCiphertext,
    ciphertextHash: encrypted.packedCiphertextHash,
  })
  void getSelfHostedSyncRuntime().wake('local-change')
}

async function commitYjsCheckpoint(binding: DocumentBinding, state: Uint8Array) {
  const database = await getDb()
  const pending = await database.select<Array<{ count: number }>>(
    `select count(*) as count from self_hosted_outbox
     where workspace_id = $1 and state in ('pending', 'retry', 'blocked')
       and json_extract(payload, '$.type') in ('append-update', 'commit-checkpoint')
       and json_extract(payload, '$.documentId') = $2`,
    [binding.workspaceId, binding.documentId]
  )
  if ((pending[0]?.count ?? 0) > 0) return
  const sequences = await database.select<Array<{ sequence: string }>>(
    `select coalesce(max(cast(document_sequence as integer)), 0) as sequence
     from self_hosted_yjs_updates where workspace_id = $1 and document_id = $2`,
    [binding.workspaceId, binding.documentId]
  )
  if (!sequences[0]?.sequence || sequences[0].sequence === '0') return
  const revisions = await database.select<Array<{ revision: string }>>(
    `select revision from self_hosted_revisions where workspace_id = $1 and object_id = $2
     order by cast(revision as integer) desc limit 1`,
    [binding.workspaceId, binding.objectId]
  )
  const commandId = crypto.randomUUID()
  const key = await loadWorkspaceKey(binding.workspaceId, binding.keyVersion)
  const encrypted = await encryptJson(key, {
    format: 'yjs-v1', update: bytesToBase64Url(state),
  } satisfies YjsEnvelope, objectAssociatedData(binding.workspaceId, binding.objectId, binding.kind))
  await insertCommand(binding.workspaceId, commandId, 'commit-checkpoint', {
    commandId,
    type: 'commit-checkpoint',
    checkpointId: crypto.randomUUID(),
    documentId: binding.documentId,
    objectId: binding.objectId,
    kind: binding.kind,
    coversDocumentSequence: sequences[0]?.sequence ?? '0',
    materializedRevision: revisions[0]?.revision ?? null,
    keyVersion: binding.keyVersion,
    ciphertext: encrypted.packedCiphertext,
    ciphertextHash: encrypted.packedCiphertextHash,
  })
  void getSelfHostedSyncRuntime().wake('local-change')
}

async function consumeYjsUpdates(
  binding: DocumentBinding,
  apply: (update: Uint8Array, checkpoint: boolean) => void,
  after: string,
) {
  const database = await getDb()
  let consumedThrough = after
  if (after === '0') {
    const checkpoints = await database.select<Array<{
      sequence: string
      payload: string
      keyVersion: number | null
    }>>(
      `select document_sequence as sequence, payload, key_version as keyVersion
       from self_hosted_yjs_updates
       where workspace_id = $1 and document_id = $2 and event_type = 'checkpoint'
       order by cast(document_sequence as integer) desc limit 1`,
      [binding.workspaceId, binding.documentId]
    )
    const checkpoint = checkpoints[0]
    if (checkpoint) {
      const key = await loadWorkspaceKey(
        binding.workspaceId,
        checkpoint.keyVersion ?? binding.keyVersion,
      )
      const value = await decryptPackedJson<YjsEnvelope>(
        key,
        checkpoint.payload,
        objectAssociatedData(binding.workspaceId, binding.objectId, binding.kind),
      )
      apply(base64UrlToBytes(value.update), true)
      consumedThrough = checkpoint.sequence
    }
  }
  const rows = await database.select<Array<{
    sequence: string
    payload: string
    eventType: string
    keyVersion: number | null
  }>>(
    `select document_sequence as sequence, payload, event_type as eventType, key_version as keyVersion
     from self_hosted_yjs_updates where workspace_id = $1 and document_id = $2
       and cast(document_sequence as integer) > cast($3 as integer)
     order by cast(document_sequence as integer)`,
    [binding.workspaceId, binding.documentId, consumedThrough]
  )
  for (const row of rows) {
    const key = await loadWorkspaceKey(binding.workspaceId, row.keyVersion ?? binding.keyVersion)
    const value = await decryptPackedJson<YjsEnvelope>(
      key, row.payload, objectAssociatedData(binding.workspaceId, binding.objectId, binding.kind),
    )
    apply(base64UrlToBytes(value.update), row.eventType === 'checkpoint')
    await database.execute(
      `update self_hosted_yjs_updates set applied = 1
       where workspace_id = $1 and document_id = $2 and document_sequence = $3`,
      [binding.workspaceId, binding.documentId, row.sequence]
    )
    consumedThrough = row.sequence
  }
  if (rows.length > 0) {
    console.info('[self-hosted-sync] document.updates-applied', {
      workspaceId: binding.workspaceId,
      documentId: binding.documentId,
      count: rows.length,
      through: rows.at(-1)?.sequence,
    })
  }
  return consumedThrough
}

async function resolveDocument(localRoot: string, relativePath: string): Promise<DocumentBinding> {
  const database = await getDb()
  const portable = await invoke<{ normalized: string; caseFolded: string }>('self_hosted_portable_path', {
    relativePath,
  })
  const rows = await database.select<Array<{ workspaceId: string; objectId: string }>>(
    `select b.workspace_id as workspaceId, m.object_id as objectId
     from self_hosted_workspace_bindings b join self_hosted_object_mappings m
       on m.workspace_id = b.workspace_id
     where b.local_root = $1 and m.relative_path = $2 and m.kind = 'note' and m.deleted_at is null
       and b.binding_state = 'bound' limit 1`,
    [localRoot, portable.normalized]
  )
  const row = rows[0]
  if (row) {
    await ensureCollaborativeObjectActive(
      database,
      row.workspaceId,
      row.objectId,
      portable.normalized,
    )
    return {
      ...row, documentId: row.objectId, kind: 'note', keyVersion: await latestKeyVersion(row.workspaceId),
    }
  }
  const bindings = await database.select<Array<{ workspaceId: string }>>(
    `select workspace_id as workspaceId from self_hosted_workspace_bindings
     where local_root = $1 and binding_state = 'bound' limit 1`,
    [localRoot]
  )
  const workspaceId = bindings[0]?.workspaceId
  if (!workspaceId) throw new Error('文档尚未绑定到自托管工作区')
  const deletedMappings = await database.select<Array<{ objectId: string }>>(
    `select object_id as objectId from self_hosted_object_mappings
     where workspace_id = $1 and kind = 'note' and local_identity = $2
       and deleted_at is not null limit 1`,
    [workspaceId, `file:${portable.normalized}`],
  )
  const deletedMapping = deletedMappings[0]
  if (deletedMapping) {
    await database.execute(
      `update self_hosted_object_mappings
       set local_identity = $1, relative_path = null, path_casefold = null, updated_at = $2
       where workspace_id = $3 and object_id = $4`,
      [
        `superseded:note:${deletedMapping.objectId}`,
        Date.now(),
        workspaceId,
        deletedMapping.objectId,
      ],
    )
  }
  const objectId = deletedMapping
    ? crypto.randomUUID()
    : await invoke<string>('self_hosted_import_object_id', {
        workspaceId, relativePath: `file/${portable.normalized}`,
      })
  await database.execute(
    `insert or ignore into self_hosted_object_mappings(
       workspace_id, object_id, kind, local_identity, relative_path, path_casefold, updated_at
     ) values ($1, $2, 'note', $3, $4, $5, $6)`,
    [workspaceId, objectId, `file:${portable.normalized}`, portable.normalized, portable.caseFolded, Date.now()]
  )
  const mappings = await database.select<Array<{ objectId: string }>>(
    `select object_id as objectId from self_hosted_object_mappings
     where workspace_id = $1 and kind = 'note' and local_identity = $2
       and deleted_at is null limit 1`,
    [workspaceId, `file:${portable.normalized}`],
  )
  const resolvedObjectId = mappings[0]?.objectId ?? objectId
  await ensureCollaborativeObjectActive(
    database,
    workspaceId,
    resolvedObjectId,
    portable.normalized,
  )
  return {
    workspaceId, objectId: resolvedObjectId, documentId: resolvedObjectId, kind: 'note',
    keyVersion: await latestKeyVersion(workspaceId),
  }
}

async function ensureCollaborativeObjectActive(
  database: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
  objectId: string,
  relativePath: string,
) {
  const objectStates = await database.select<Array<{
    revision: string | null
    deletedAt: number | null
  }>>(
    `select r.revision, m.deleted_at as deletedAt
     from self_hosted_object_mappings m
     left join self_hosted_revisions r
       on r.workspace_id = m.workspace_id and r.object_id = m.object_id
     where m.workspace_id = $1 and m.object_id = $2
     order by cast(r.revision as integer) desc limit 1`,
    [workspaceId, objectId],
  )
  if (!objectStates[0]?.revision || objectStates[0].deletedAt !== null) {
    await enqueueFileSnapshot(relativePath, 'upsert', workspaceId, 'import')
    await getSelfHostedSyncRuntime().wake('collaboration-object-activation')
  }
}

async function latestKeyVersion(workspaceId: string) {
  const database = await getDb()
  const rows = await database.select<Array<{ keyVersion: number }>>(
    `select max(key_version) as keyVersion from self_hosted_workspace_keys where workspace_id = $1`,
    [workspaceId]
  )
  return rows[0]?.keyVersion ?? 1
}

async function insertCommand(workspaceId: string, commandId: string, type: string, payload: object) {
  const database = await getDb()
  const now = Date.now()
  const objectId = 'objectId' in payload && typeof payload.objectId === 'string' ? payload.objectId : null
  const objects = objectId ? await database.select<Array<{
    revision: string | null
    deletedAt: number | null
  }>>(
    `select r.revision, m.deleted_at as deletedAt
     from self_hosted_object_mappings m
     left join self_hosted_revisions r
       on r.workspace_id = m.workspace_id and r.object_id = m.object_id
     where m.workspace_id = $1 and m.object_id = $2
     order by cast(r.revision as integer) desc limit 1`,
    [workspaceId, objectId]
  ) : []
  const object = objects[0]
  const state = objectId && (!object?.revision || object.deletedAt !== null) ? 'blocked' : 'pending'
  await database.execute(
    `insert into self_hosted_outbox(
       command_id, workspace_id, source_change_ids, command_type, payload, state, created_at, updated_at
     ) values ($1, $2, '[]', $3, $4, $5, $6, $6)`,
    [commandId, workspaceId, type, JSON.stringify(payload), state, now]
  )
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = ''
  value.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
}
