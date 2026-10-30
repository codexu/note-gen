import { getDb } from '@/db'
import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { encryptJson, decryptPackedJson, encodeUtf8Base64Url, loadWorkspaceKey, objectAssociatedData } from './crypto'
import { getSelfHostedSyncRuntime } from './runtime'
import { authenticatedClient, getProfile } from './profile'
import { enqueueFileSnapshot, ensureLibraryObjectMapping } from './outbox'
import { isPersonalSyncKindEnabled } from './domains'
import emitter from '@/lib/emitter'
import { trackMarkdownCollaboration } from './markdown-state'

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

interface LocalAppend {
  commandId: string
  updateId: string
  update: Uint8Array
  encrypted?: Awaited<ReturnType<typeof encryptJson>>
}

export type PresenceCoordinateSpace = 'markdown' | 'prosemirror'

let collaborationGeneration = 0
let collaborationPauseDepth = 0
const operations = new Set<Promise<unknown>>()
const pendingLocalPersistence = new Set<() => Promise<void>>()
const pausedDocuments = new Map<string, { generation: number; depth: number }>()

export function pauseSelfHostedDocumentCollaboration(workspaceId: string, objectId: string): () => void {
  const key = `${workspaceId}\0${objectId}`
  const state = pausedDocuments.get(key) ?? { generation: 0, depth: 0 }
  state.generation++
  state.depth++
  pausedDocuments.set(key, state)
  let resumed = false
  return () => {
    if (resumed) return
    resumed = true
    state.depth = Math.max(0, state.depth - 1)
  }
}

export function pauseSelfHostedCollaboration(): () => void {
  collaborationGeneration++
  collaborationPauseDepth++
  let resumed = false
  return () => {
    if (resumed) return
    resumed = true
    collaborationPauseDepth = Math.max(0, collaborationPauseDepth - 1)
  }
}

export function captureSelfHostedCollaboration() {
  const generation = collaborationGeneration
  return () => collaborationPauseDepth === 0 && generation === collaborationGeneration
}

export async function waitForSelfHostedCollaborationIdle() {
  for (;;) {
    await Promise.allSettled([...operations])
    // Rejections remain registered until their original admitted bytes commit.
    // Retry once per drain attempt; failures propagate and block a snapshot.
    for (const persist of [...pendingLocalPersistence]) await persist()
    if (!operations.size && !pendingLocalPersistence.size) return
  }
}

function trackOperation<T>(action: () => Promise<T>): Promise<T> {
  const operation = action()
  operations.add(operation)
  void operation.then(() => operations.delete(operation), () => operations.delete(operation))
  return operation
}

function requireActive(isActive: () => boolean) {
  return () => {
    if (!isActive()) throw new Error('SELF_HOSTED_COLLABORATION_PAUSED')
  }
}

export async function openCollaborativeDocument(localRoot: string, relativePath: string) {
  const isActive = captureSelfHostedCollaboration()
  const assertActive = requireActive(isActive)
  return trackOperation(async () => {
    await assertCollaborationEntry()
    assertActive()
    const binding = await resolveDocument(localRoot, relativePath, assertActive)
    assertActive()
    return openCollaborativeBinding(binding, isActive)
  })
}

export async function openCollaborativeObject(
  workspaceId: string,
  objectId: string,
  documentId: string,
  kind: 'note' | 'canvas',
) {
  const isActive = captureSelfHostedCollaboration()
  const assertActive = requireActive(isActive)
  return trackOperation(async () => {
    await assertCollaborationEntry()
    assertActive()
    const keyVersion = await latestKeyVersion(workspaceId)
    assertActive()
    const binding = { workspaceId, objectId, documentId, kind, keyVersion }
    await assertBindingEnabled(binding)
    assertActive()
    return openCollaborativeBinding(binding, isActive)
  })
}

async function resolvePresenceIdentity(workspaceId: string) {
  const database = await getDb()
  const [row] = await database.select<Array<{ profileId: string }>>(
    `select profile_id as profileId from self_hosted_workspace_bindings where workspace_id = $1 limit 1`,
    [workspaceId],
  )
  const profile = row ? await getProfile(row.profileId) : null
  const names = new Map<string, string>()
  if (profile) {
    try {
      const { client } = await authenticatedClient(profile.id)
      const members = await client.members(workspaceId)
      for (const member of members) names.set(member.accountId, member.login)
    } catch (error) {
      console.warn('[self-hosted-sync] Unable to resolve collaborator name:', error)
    }
  }
  return (message: Record<string, unknown>) => {
    const accountId = typeof message.accountId === 'string' ? message.accountId : null
    const deviceLabel = message.label === '桌面端' ? 'PC 端' : message.label
    // Older servers do not identify the account in presence messages.
    if (!accountId || accountId === profile?.accountId) return deviceLabel
    return names.get(accountId) || accountId.replaceAll('-', '').slice(0, 8)
  }
}

async function openCollaborativeBinding(binding: DocumentBinding, generationActive: () => boolean) {
  let closed = false
  const documentKey = `${binding.workspaceId}\0${binding.objectId}`
  const documentGeneration = pausedDocuments.get(documentKey)?.generation ?? 0
  const isActive = () => {
    const state = pausedDocuments.get(documentKey)
    return !closed && generationActive() && (state?.depth ?? 0) === 0
      && (state?.generation ?? 0) === documentGeneration
  }
  const assertActive = requireActive(isActive)
  const presenceLabel = await resolvePresenceIdentity(binding.workspaceId)
  assertActive()
  const runtime = getSelfHostedSyncRuntime()
  const presenceOwner = Symbol('collaboration-presence')
  const unsubscribeDocument = runtime.subscribeDocument(binding.workspaceId, binding.documentId)
  const untrackMarkdown = binding.kind === 'note'
    ? trackMarkdownCollaboration(binding.workspaceId, binding.objectId) : () => {}
  let consumedThrough = '0'
  const consumedLocalCommands = new Set<string>()
  let appendQueue: Promise<void> = Promise.resolve()
  let admissionQueue: Promise<void> = Promise.resolve()
  const localUpdates: LocalAppend[] = []
  function persistAdmittedUpdates(): Promise<void> {
    const previous = appendQueue
    const operation = trackOperation(async () => {
      await previous
      while (localUpdates.length) {
        await appendYjsUpdate(binding, localUpdates[0], isActive)
        localUpdates.shift()
      }
      pendingLocalPersistence.delete(persistAdmittedUpdates)
    })
    appendQueue = operation.catch(() => undefined)
    return operation
  }
  function persistLocalUpdates(): Promise<void> {
    return trackOperation(async () => {
      await admissionQueue
      await persistAdmittedUpdates()
    })
  }
  return {
    ...binding,
    isActive,
    initialize: (update: Uint8Array) => trackOperation(async () => {
      assertActive()
      return initializeYjsDocument(binding, update, assertActive)
    }),
    appendUpdate: (update: Uint8Array) => {
      // Capture the bytes and register the operation synchronously at the Yjs
      // event. The admission queue checks entry policy before adding them to
      // local persistence; idle also waits for this pending admission phase.
      if (!isActive()) return Promise.reject(new Error('SELF_HOSTED_COLLABORATION_PAUSED'))
      const local = { commandId: crypto.randomUUID(), updateId: crypto.randomUUID(), update: update.slice() }
      const previous = admissionQueue
      const operation = trackOperation(async () => {
        await previous
        await assertCollaborationEntry()
        localUpdates.push(local)
        pendingLocalPersistence.add(persistAdmittedUpdates)
        await persistAdmittedUpdates()
      })
      admissionQueue = operation.catch(() => undefined)
      return operation
    },
    // This method accepts no new state. It may finish pre-admitted writes even
    // after pause/close, and remains part of the authoritative snapshot fence.
    persistLocalUpdates,
    preserveLocalConflict: (input: {
      id: string; localRoot: string; relativePath: string; local: string; remote: string; base: string
    }) => trackOperation(async () => {
      await assertCollaborationEntry()
      await assertBindingPermissions(binding)
      assertActive()
      await invoke('self_hosted_atomic_write', {
        workspaceId: binding.workspaceId, objectId: null, workspaceRoot: input.localRoot,
        relativePath: input.relativePath, contents: encodeUtf8Base64Url(input.local),
        expectedHash: await invoke<string>('self_hosted_sha256', { value: input.local }),
      })
      const database = await getDb()
      assertActive()
      await database.execute(
        `insert into self_hosted_conflicts(id, workspace_id, object_id, conflict_type,
           local_snapshot, remote_snapshot, base_snapshot, local_copy_path, state, created_at)
         values ($1,$2,$3,'snapshot-diverged',$4,$5,$6,$7,'unresolved',$8)
         on conflict(id) do update set local_snapshot=excluded.local_snapshot,
           remote_snapshot=excluded.remote_snapshot, base_snapshot=excluded.base_snapshot,
           local_copy_path=excluded.local_copy_path, state='unresolved', resolved_at=null`,
        [input.id, binding.workspaceId, binding.objectId, input.local, input.remote, input.base, input.relativePath, Date.now()],
      )
      emitter.emit('self-hosted-conflicts-changed', undefined)
      assertActive()
      return input.relativePath
    }),
    checkpoint: (state: Uint8Array) => trackOperation(async () => {
      if (isActive()) await commitYjsCheckpoint(binding, state, assertActive)
    }),
    flush: () => isActive() ? runtime.wake('collaboration-flush') : Promise.resolve(),
    consume: async (apply: (update: Uint8Array, checkpoint: boolean) => void) => {
      if (!isActive()) return
      return trackOperation(async () => {
        let pullError: unknown = null
        try {
          await pullDocumentUpdates(binding, assertActive)
        } catch (error) {
          pullError = error
        }
        if (!isActive()) return
        consumedThrough = await consumeYjsUpdates(binding, apply, consumedThrough, consumedLocalCommands, assertActive)
        if (pullError) throw pullError
      })
    },
    updatePresence: (
      anchor: number,
      head: number,
      label: string,
      coordinateSpace: PresenceCoordinateSpace,
    ) => {
      if (!isActive()) return
      runtime.updatePresence(
        binding.workspaceId,
        binding.documentId,
        anchor,
        head,
        label === '桌面端' ? 'PC 端' : label,
        coordinateSpace,
        presenceOwner,
      )
    },
    clearPresence: () => { if (isActive()) runtime.clearPresence(presenceOwner) },
    updateCanvasPresence: (nodes: Array<{ id: string; x: number; y: number }>, label: string) => {
      if (!isActive()) return
      runtime.updateCanvasPresence(
        binding.workspaceId,
        binding.documentId,
        nodes,
        label,
        presenceOwner,
      )
    },
    subscribePresence: (listener: (message: Record<string, unknown>) => void) => {
      if (!isActive()) return () => {}
      return runtime.subscribeRealtime(message => {
        if (isActive() && message.workspaceId === binding.workspaceId
          && (message.documentId === binding.documentId || message.type === 'workspace.changed'
            || message.type === 'inbox.applied')) {
          listener(message.type === 'presence.updated'
            ? { ...message, label: presenceLabel(message) }
            : message)
        }
      })
    },
    close: () => {
      if (closed) return
      closed = true
      untrackMarkdown()
      unsubscribeDocument()
      runtime.clearPresence(presenceOwner)
    },
  }
}

async function initializeYjsDocument(binding: DocumentBinding, update: Uint8Array, assertActive: () => void) {
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
  await assertBindingEnabled(binding, true)
  assertActive()
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

async function pullDocumentUpdates(binding: DocumentBinding, assertActive: () => void) {
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
    await assertBindingEnabled(binding)
    assertActive()
    const page = await client.documentUpdates(
      binding.workspaceId,
      binding.documentId,
      after,
      localBinding.syncEpoch,
    )
    assertActive()
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
      assertActive()
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

async function appendYjsUpdate(binding: DocumentBinding, local: LocalAppend, shouldWake: () => boolean) {
  if (!local.encrypted) {
    const key = await loadWorkspaceKey(binding.workspaceId, binding.keyVersion)
    local.encrypted = await encryptJson(key, {
      format: 'yjs-v1', update: bytesToBase64Url(local.update),
    } satisfies YjsEnvelope, objectAssociatedData(binding.workspaceId, binding.objectId, binding.kind))
  }
  const encrypted = local.encrypted
  const { commandId, updateId } = local
  await assertBindingPermissions(binding, true)
  // This operation was admitted before pause/close. It remains in the global
  // idle fence until SQLite commits, so a later authoritative snapshot cannot
  // be followed by an append from the previous generation.
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
  if (shouldWake()) {
    // Recovery markers and a non-self-hosted primary pause the sender, while
    // pre-admitted local writes must remain drainable for recovery snapshots.
    try { await assertCollaborationEntry() } catch { return }
    if (shouldWake()) void getSelfHostedSyncRuntime().wake('local-change')
  }
}

async function commitYjsCheckpoint(binding: DocumentBinding, state: Uint8Array, assertActive: () => void) {
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
  await assertBindingEnabled(binding, true)
  assertActive()
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
  }, assertActive)
  assertActive()
  void getSelfHostedSyncRuntime().wake('local-change')
}

async function consumeYjsUpdates(
  binding: DocumentBinding,
  apply: (update: Uint8Array, checkpoint: boolean) => void,
  after: string,
  consumedLocalCommands: Set<string>,
  assertActive: () => void,
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
      await assertBindingEnabled(binding)
      assertActive()
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
    await assertBindingEnabled(binding)
    assertActive()
    apply(base64UrlToBytes(value.update), row.eventType === 'checkpoint')
    assertActive()
    await database.execute(
      `update self_hosted_yjs_updates set applied = 1
       where workspace_id = $1 and document_id = $2 and document_sequence = $3`,
      [binding.workspaceId, binding.documentId, row.sequence]
    )
    consumedThrough = row.sequence
  }
  // A document reopened while offline must include locally persisted updates.
  // They may not have a server document sequence yet. Reapplying them on later
  // pulls is safe because Yjs update identities are idempotent. Include retained
  // acknowledgements too: an ACK can race the HTTP pull's snapshot.
  const local = await database.select<Array<{ commandId: string; payload: string }>>(
    `select o.command_id as commandId, o.payload from self_hosted_outbox o
     where o.workspace_id = $1 and o.command_type in ('append-update', 'commit-checkpoint')
       and o.state <> 'superseded'
       and json_extract(o.payload, '$.documentId') = $2
       and not exists (
         select 1 from self_hosted_yjs_updates y where y.workspace_id = o.workspace_id
           and y.document_id = $2 and cast(y.document_sequence as integer) <= cast($3 as integer)
           and y.update_id = coalesce(json_extract(o.payload, '$.updateId'), json_extract(o.payload, '$.checkpointId'))
       ) order by o.created_at, o.rowid`,
    [binding.workspaceId, binding.documentId, consumedThrough],
  )
  for (const row of local) {
    if (consumedLocalCommands.has(row.commandId)) continue
    const command = JSON.parse(row.payload) as { ciphertext: string; keyVersion: number }
    const key = await loadWorkspaceKey(binding.workspaceId, command.keyVersion)
    const value = await decryptPackedJson<YjsEnvelope>(
      key, command.ciphertext, objectAssociatedData(binding.workspaceId, binding.objectId, binding.kind),
    )
    await assertBindingEnabled(binding)
    assertActive()
    apply(base64UrlToBytes(value.update), false)
    consumedLocalCommands.add(row.commandId)
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

async function assertBindingEnabled(binding: DocumentBinding, writing = false) {
  if (writing) await assertCollaborationEntry()
  return assertBindingPermissions(binding, writing)
}

async function assertCollaborationEntry() {
  const store = await Store.load('store.json')
  if (await store.get('primaryBackupMethod') !== 'selfHosted'
    || await store.get('platformSwitchRecovery')
    || await store.get('selfHostedConnectionReviewProfileId')) throw new Error('SELF_HOSTED_COLLABORATION_PAUSED')
}

async function assertBindingPermissions(binding: DocumentBinding, writing = false) {
  const database = await getDb()
  const [row] = await database.select<Array<{
    profileId: string; workspaceType: string; bindingState: string; accessMode: string
  }>>(
    `select profile_id as profileId, workspace_type as workspaceType,
       binding_state as bindingState, access_mode as accessMode
     from self_hosted_workspace_bindings where workspace_id = $1 limit 1`,
    [binding.workspaceId],
  )
  if (!row || row.bindingState !== 'bound') throw new Error('SELF_HOSTED_COLLABORATION_PAUSED')
  if (writing && row.accessMode === 'read-only') throw new Error('SELF_HOSTED_WORKSPACE_READ_ONLY')
  if (row.workspaceType === 'account-data') {
    const profile = await getProfile(row.profileId)
    if (!profile || !isPersonalSyncKindEnabled(binding.kind, profile.domainToggles)) {
      throw new Error('SELF_HOSTED_DOMAIN_DISABLED')
    }
  }
}

async function resolveDocument(localRoot: string, relativePath: string, assertActive: () => void): Promise<DocumentBinding> {
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
      assertActive,
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
  const { objectId: resolvedObjectId } = await ensureLibraryObjectMapping(
    workspaceId, 'file', portable.normalized, { deterministicImport: true, assertActive },
  )
  await ensureCollaborativeObjectActive(
    database,
    workspaceId,
    resolvedObjectId,
    portable.normalized,
    assertActive,
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
  assertActive: () => void,
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
    assertActive()
    await enqueueFileSnapshot(relativePath, 'upsert', workspaceId, 'import')
    assertActive()
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

async function insertCommand(workspaceId: string, commandId: string, type: string, payload: object, assertActive?: () => void) {
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
  assertActive?.()
  await database.execute(
    `insert into self_hosted_outbox(
       command_id, workspace_id, source_change_ids, command_type, payload, state, created_at, updated_at
     ) values ($1, $2, '[]', $3, $4, $5, $6, $6)
     on conflict(command_id) do nothing`,
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
