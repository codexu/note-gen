import { invoke } from '@tauri-apps/api/core'
import { exists, readFile, readTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { getDb } from '@/db'
import { SelfHostedApiError } from './client'
import {
  authenticatedClient, isSelfHostedAuthenticationError, reconcilePersonalWorkspaceObjects,
  markProfileReauthenticationRequired, secureDelete,
} from './profile'
import { decryptPackedJson, encodeUtf8Base64Url, loadWorkspaceKey, objectAssociatedData } from './crypto'
import {
  enqueueAssetSnapshot,
  enqueueFileSnapshot,
  enqueueFolderSnapshot,
  materializeOutbox,
} from './outbox'
import { applyStructuredPayload, deleteStructuredObject } from './structured'
import { ensureManagedWorkspaceKeys, reconcileLibraryFiles } from './workspaces'
import { bytesToBase64Url, downloadAsset, hashBytes } from './blob'
import type { SyncBootstrapPage, SyncEvent, SyncObjectKind, SyncSession } from './protocol'
import emitter from '@/lib/emitter'
import {
  editorPathsReferToSameFile,
  getEditorPathMutationRevision,
  markEditorPathMutation,
  prepareActiveEditorDeactivation,
  prepareActiveEditorPathMutationDurably,
  runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'

interface Binding {
  workspaceId: string
  profileId: string
  workspaceType: 'account-data' | 'library'
  localRoot: string | null
  syncEpoch: string | null
  pulledSequence: string
  appliedSequence: string
  bindingState: 'bound' | 'bootstrapping' | 'epoch-changed'
}

interface OutboxRow {
  commandId: string
  sourceChangeIds: string
  payload: string
  attemptCount: number
}

export class SelfHostedSyncRuntime {
  #running = false
  #rerun = false
  #stopped = true
  #wakeCompletion: Promise<void> | null = null
  #socket: WebSocket | null = null
  #socketWorkspaceSignature = ''
  #timer: ReturnType<typeof setTimeout> | null = null
  #realtimeListeners = new Set<(message: Record<string, unknown>) => void>()
  #documentSubscriptions = new Map<string, number>()
  #presence: Record<string, unknown> | null = null
  #presenceOwner: symbol | null = null

  start() {
    this.#stopped = false
    void this.wake('startup')
  }

  async bindingIsReady(workspaceId: string) {
    const rows = await (await getDb()).select<Array<{ bindingState: string }>>(
      `select binding_state as bindingState from self_hosted_workspace_bindings
       where workspace_id = $1 limit 1`,
      [workspaceId],
    )
    return rows[0]?.bindingState === 'bound'
  }

  stop() {
    this.#stopped = true
    this.#socket?.close()
    this.#socket = null
    this.#socketWorkspaceSignature = ''
    this.#presence = null
    this.#presenceOwner = null
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  subscribeRealtime(listener: (message: Record<string, unknown>) => void) {
    this.#realtimeListeners.add(listener)
    return () => this.#realtimeListeners.delete(listener)
  }

  subscribeDocument(workspaceId: string, documentId: string) {
    const key = `${workspaceId}\0${documentId}`
    const subscribers = this.#documentSubscriptions.get(key) ?? 0
    this.#documentSubscriptions.set(key, subscribers + 1)
    if (subscribers === 0) {
      this.#sendRealtime({ type: 'document.subscribe', workspaceId, documentId })
    }
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      const remaining = (this.#documentSubscriptions.get(key) ?? 1) - 1
      if (remaining > 0) {
        this.#documentSubscriptions.set(key, remaining)
        return
      }
      this.#documentSubscriptions.delete(key)
      this.#sendRealtime({ type: 'document.unsubscribe', workspaceId, documentId })
    }
  }

  updatePresence(
    workspaceId: string,
    documentId: string,
    anchor: number,
    head: number,
    label: string,
    coordinateSpace: 'markdown' | 'prosemirror',
    owner: symbol,
  ) {
    this.#presenceOwner = owner
    this.#presence = {
      type: 'presence.update', workspaceId, documentId, anchor, head, label, coordinateSpace, canvas: null,
    }
    this.#sendRealtime(this.#presence)
  }

  updateCanvasPresence(
    workspaceId: string,
    documentId: string,
    nodes: Array<{ id: string; x: number; y: number }>,
    label: string,
    owner: symbol,
  ) {
    this.#presenceOwner = owner
    this.#presence = {
      type: 'presence.update', workspaceId, documentId, anchor: 0, head: 0,
      label, coordinateSpace: 'canvas', canvas: { nodes },
    }
    this.#sendRealtime(this.#presence)
  }

  clearPresence(owner: symbol) {
    if (this.#presenceOwner !== owner) return
    this.#presence = null
    this.#presenceOwner = null
    this.#sendRealtime({ type: 'presence.clear' })
  }

  #sendRealtime(message: Record<string, unknown>) {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message))
  }

  wake(reason: string): Promise<void> {
    if (this.#stopped) return Promise.resolve()
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    if (this.#running) {
      this.#rerun = true
      return this.#wakeCompletion ?? Promise.resolve()
    }
    this.#running = true
    const completion = this.#runWake(reason)
    this.#wakeCompletion = completion
    return completion
  }

  async #runWake(reason: string) {
    try {
      do {
        this.#rerun = false
        const bindings = await listBindings()
        const sessions: Array<{ profileId: string; session: SyncSession }> = []
        for (const binding of bindings) {
          try {
            const session = await this.#syncBinding(binding)
            if (session) sessions.push({ profileId: binding.profileId, session })
          } catch (error) {
            if (isSelfHostedAuthenticationError(error)) throw error
            console.warn('[self-hosted-sync] Workspace synchronization failed', {
              reason,
              workspaceId: binding.workspaceId,
              workspaceType: binding.workspaceType,
              error,
            })
          }
        }
        if (sessions.length > 0) this.#connectSocket(sessions[0].profileId, sessions.map(item => item.session))
      } while (this.#rerun && !this.#stopped)
    } catch (error) {
      if (isSelfHostedAuthenticationError(error)) {
        const bindings = await listBindings()
        await Promise.all(bindings.map(binding => markProfileReauthenticationRequired(binding.profileId)))
        this.#stopped = true
        this.#socket?.close()
        this.#socket = null
        this.#socketWorkspaceSignature = ''
      } else {
        console.warn('[self-hosted-sync] Synchronization paused until the next retry', { reason, error })
      }
    } finally {
      this.#running = false
      this.#wakeCompletion = null
      if (!this.#stopped) {
        this.#timer = setTimeout(() => void this.wake('network'), 30_000)
      }
    }
  }

  async #syncBinding(binding: Binding) {
    const { profile, client } = await authenticatedClient(binding.profileId)
    let session: SyncSession
    try {
      session = await client.syncSession(
        binding.workspaceId,
        binding.appliedSequence,
        binding.bindingState === 'epoch-changed' ? undefined : binding.syncEpoch ?? undefined,
      )
    } catch (error) {
      if (error instanceof SelfHostedApiError && error.body.code === 'sync_epoch_changed') {
        await setBindingState(binding.workspaceId, 'epoch-changed')
        this.#rerun = true
        return null
      }
      if (error instanceof SelfHostedApiError && (error.status === 403 || error.status === 404)) {
        await revokeBindingAccess(binding.workspaceId)
        return null
      }
      throw error
    }
    if (!session.protocol.compatible) {
      await setBindingState(binding.workspaceId, 'protocol-incompatible')
      return null
    }
    await ensureManagedWorkspaceKeys(
      binding.profileId,
      binding.workspaceId,
      session.keyVersions.map(key => key.keyVersion),
    )
    if (
      session.bootstrap.required
      || binding.bindingState !== 'bound'
      || await hasCoveredFailedInbox(binding)
      || await hasAmbiguousTombstonedLibraryFile(binding)
    ) {
      await setBindingState(binding.workspaceId, 'bootstrapping')
      await bootstrapBinding(binding, session)
      await refreshBindingStores(binding)
      emitter.emit('self-hosted-binding-ready', { workspaceId: binding.workspaceId })
      // Run reconciliation immediately against the authoritative snapshot so
      // local-only mobile files are uploaded without waiting for the timer.
      this.#rerun = true
      return session
    }
    await updateBindingSession(
      binding.workspaceId,
      session.syncEpoch,
      session.workspace.capabilities.includes('content.update'),
    )
    if (binding.workspaceType === 'library' && binding.localRoot) {
      await reconcileLibraryFiles(
        binding.workspaceId,
        binding.localRoot,
        session.workspace.capabilities.includes('content.update'),
      )
    }
    if (binding.workspaceType === 'account-data') {
      await reconcilePersonalWorkspaceObjects(binding.workspaceId)
    }
    await materializeOutbox(
      binding.workspaceId,
      binding.workspaceType,
      binding.localRoot,
      session.limits.maxCommandsPerBatch,
      binding.profileId,
      session.syncEpoch,
      Math.max(1, ...session.keyVersions.map(key => key.keyVersion)),
      session.limits.maxObjectBytes,
    )
    if (await pushOutbox(binding, session)) this.#rerun = true
    await pullEvents(binding, session)
    const appliedThrough = await applyInbox(
      binding,
      profile.deviceId,
      objectId => this.#documentSubscriptions.has(`${binding.workspaceId}\0${objectId}`),
    )
    for (const listener of this.#realtimeListeners) listener({
      type: 'inbox.applied', workspaceId: binding.workspaceId,
    })
    if (BigInt(appliedThrough) > BigInt(binding.appliedSequence)) {
      await client.acknowledge(binding.workspaceId, appliedThrough, session.syncEpoch)
      await updateCursor(binding.workspaceId, appliedThrough, appliedThrough)
    }
    await pruneDurableSyncHistory(binding.workspaceId)
    emitter.emit('self-hosted-binding-ready', { workspaceId: binding.workspaceId })
    return session
  }

  #connectSocket(profileId: string, sessions: SyncSession[]) {
    const first = sessions[0]
    if (!first) return
    const workspaceSignature = sessions.map(session => session.workspace.id).sort().join('\0')
    if (this.#socket?.url === first.websocketUrl
      && this.#socketWorkspaceSignature === workspaceSignature
      && this.#socket.readyState <= WebSocket.OPEN) return
    this.#socket?.close()
    this.#socketWorkspaceSignature = workspaceSignature
    void authenticatedClient(profileId).then(async ({ accessToken }) => {
      if (this.#stopped || this.#socketWorkspaceSignature !== workspaceSignature) return
      const socket = new WebSocket(first.websocketUrl)
      this.#socket = socket
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
          type: 'authenticate',
          accessToken,
          workspaceIds: sessions.map(session => session.workspace.id),
          expectedSyncEpoch: first.syncEpoch,
        }))
      })
      socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data)) as { type?: string; workspaceId?: string }
        for (const listener of this.#realtimeListeners) listener(message)
        if (message.type === 'authenticated') {
          for (const subscription of this.#documentSubscriptions.keys()) {
            const [workspaceId, documentId] = subscription.split('\0')
            socket.send(JSON.stringify({ type: 'document.subscribe', workspaceId, documentId }))
          }
          if (this.#presence) socket.send(JSON.stringify(this.#presence))
        } else if (message.type === 'workspace.changed' || message.type === 'workspace.members-changed') {
          void this.wake('websocket')
        } else if (message.type === 'workspace.access-revoked' && message.workspaceId) {
          void revokeBindingAccess(message.workspaceId)
        }
      })
      socket.addEventListener('close', () => {
        if (this.#socket === socket) {
          this.#socket = null
          this.#socketWorkspaceSignature = ''
        }
      })
    }).catch(error => {
      if (!isSelfHostedAuthenticationError(error)) {
        console.warn('[self-hosted-sync] Unable to connect realtime channel', error)
      }
    })
  }
}

async function hasCoveredFailedInbox(binding: Binding) {
  const database = await getDb()
  const rows = await database.select<Array<{ found: number }>>(
    `select 1 as found from self_hosted_inbox
     where workspace_id = $1 and state = 'failed'
       and cast(sequence as integer) <= cast($2 as integer)
     limit 1`,
    [binding.workspaceId, binding.appliedSequence],
  )
  return rows.length > 0
}

async function hasAmbiguousTombstonedLibraryFile(binding: Binding) {
  if (binding.workspaceType !== 'library' || !binding.localRoot) return false
  const database = await getDb()
  const rows = await database.select<Array<{ relativePath: string }>>(
    `select relative_path as relativePath from self_hosted_object_mappings
     where workspace_id = $1 and kind in ('note', 'asset')
       and deleted_at is not null and relative_path is not null`,
    [binding.workspaceId],
  )
  for (const row of rows) {
    if (await exists(await join(binding.localRoot, row.relativePath))) return true
  }
  return false
}

async function recoverUncoveredTombstonedPortableFiles(
  binding: Binding,
  authoritativeObjectIds: Set<string>,
) {
  if (binding.workspaceType !== 'library' || !binding.localRoot) return
  const database = await getDb()
  const rows = await database.select<Array<{
    objectId: string
    kind: string
    localIdentity: string
    relativePath: string
    pathCasefold: string | null
  }>>(
    `select object_id as objectId, kind, local_identity as localIdentity,
       relative_path as relativePath, path_casefold as pathCasefold
     from self_hosted_object_mappings where workspace_id = $1
       and kind in ('note', 'asset', 'folder')
       and deleted_at is not null and relative_path is not null`,
    [binding.workspaceId],
  )
  for (const row of rows) {
    if (authoritativeObjectIds.has(row.objectId)) continue
    if (!await exists(await join(binding.localRoot, row.relativePath))) continue
    // A tombstone omitted from the authoritative snapshot has been garbage
    // collected remotely. Treat the still-present local path as an explicit
    // recreation instead of forcing bootstrap on every wake forever.
    const activeMappings = row.pathCasefold === null ? [] : await database.select<Array<{ objectId: string }>>(
      `select object_id as objectId from self_hosted_object_mappings
       where workspace_id = $1 and path_casefold = $2 and deleted_at is null limit 1`,
      [binding.workspaceId, row.pathCasefold],
    )
    await database.execute(
      `update self_hosted_object_mappings set local_identity = $1, relative_path = null,
         path_casefold = null, updated_at = $2
       where workspace_id = $3 and object_id = $4`,
      [
        `superseded:${row.kind}:${row.objectId}`,
        Date.now(),
        binding.workspaceId,
        row.objectId,
      ],
    )
    if (activeMappings.length > 0) continue
    try {
      await database.execute(
        `insert into self_hosted_object_mappings(
           workspace_id, object_id, kind, local_identity, relative_path,
           path_casefold, content_hash, blob_refs, deleted_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, null, '[]', null, $7)`,
        [
          binding.workspaceId,
          crypto.randomUUID(),
          row.kind,
          row.localIdentity,
          row.relativePath,
          row.pathCasefold,
          Date.now(),
        ],
      )
    } catch (error) {
      await database.execute(
        `update self_hosted_object_mappings set local_identity = $1,
           relative_path = $2, path_casefold = $3, updated_at = $4
         where workspace_id = $5 and object_id = $6`,
        [
          row.localIdentity,
          row.relativePath,
          row.pathCasefold,
          Date.now(),
          binding.workspaceId,
          row.objectId,
        ],
      )
      throw error
    }
    if (row.kind === 'note') {
      await enqueueFileSnapshot(row.relativePath, 'upsert', binding.workspaceId)
    } else if (row.kind === 'asset') {
      await enqueueAssetSnapshot(row.relativePath, 'upsert', binding.workspaceId)
    } else {
      await enqueueFolderSnapshot(row.relativePath, 'upsert', binding.workspaceId)
    }
  }
}

async function pruneDurableSyncHistory(workspaceId: string) {
  const database = await getDb()
  await database.execute(
    `delete from self_hosted_inbox where rowid in (
       select rowid from self_hosted_inbox
       where workspace_id = $1 and state = 'applied'
       order by cast(sequence as integer) limit 2000
     )`,
    [workspaceId],
  )
  await database.execute(
    `delete from self_hosted_outbox where rowid in (
       select rowid from self_hosted_outbox
       where workspace_id = $1 and state in ('sent', 'superseded')
       order by updated_at limit 2000
     )`,
    [workspaceId],
  )
  await database.execute(
    `delete from self_hosted_local_changes where id in (
       select id from self_hosted_local_changes
       where state in ('sent', 'superseded')
         and (workspace_id = $1 or workspace_id is null)
       order by id limit 2000
     )`,
    [workspaceId],
  )
}

async function listBindings(): Promise<Binding[]> {
  const database = await getDb()
  return database.select<Binding[]>(`
    select b.workspace_id as workspaceId, b.profile_id as profileId,
      b.workspace_type as workspaceType, b.local_root as localRoot, b.sync_epoch as syncEpoch,
      b.binding_state as bindingState,
      coalesce(c.pulled_sequence, '0') as pulledSequence,
      coalesce(c.applied_sequence, '0') as appliedSequence
    from self_hosted_workspace_bindings b
    join self_hosted_sync_profiles p on p.id = b.profile_id and p.state = 'connected'
    left join self_hosted_cursors c on c.workspace_id = b.workspace_id
    where b.binding_state in ('bound', 'bootstrapping', 'epoch-changed')
    order by case when b.workspace_type = 'library' and b.local_root is not null then 0 else 1 end,
      b.created_at
  `)
}

async function pushOutbox(binding: Binding, session: SyncSession) {
  const database = await getDb()
  const rows = await database.select<OutboxRow[]>(
    `select command_id as commandId, source_change_ids as sourceChangeIds,
       payload, attempt_count as attemptCount
     from self_hosted_outbox o
     left join self_hosted_object_mappings m
       on m.workspace_id = o.workspace_id
      and m.object_id = json_extract(o.payload, '$.objectId')
     where o.workspace_id = $1 and o.state in ('pending', 'retry') and o.next_attempt_at <= $2
     order by
       case when json_extract(o.payload, '$.type') = 'delete-object' and m.kind = 'folder' then 2
            when m.kind = 'folder' then 0 else 1 end,
       case when m.kind = 'folder' and m.relative_path is not null
         then (case when json_extract(o.payload, '$.type') = 'delete-object' then -1 else 1 end)
           * (length(m.relative_path) - length(replace(m.relative_path, '/', '')))
         else 0 end,
       o.created_at, o.rowid limit $3`,
    [binding.workspaceId, Date.now(), session.limits.maxCommandsPerBatch]
  )
  if (rows.length === 0) return false
  let activatedCollaborativeObject = false
  const commands: Record<string, unknown>[] = []
  for (const row of rows) {
    const { command, changed } = parseOutboxCommand(row.payload)
    commands.push(command)
    if (changed) {
      row.payload = JSON.stringify(command)
      await database.execute(
        'update self_hosted_outbox set payload = $1, updated_at = $2 where command_id = $3',
        [row.payload, Date.now(), row.commandId]
      )
    }
  }
  const { client } = await authenticatedClient(binding.profileId)
  const response = await client.pushCommands(
    binding.workspaceId, commands, session.syncEpoch,
  )
  for (const result of response.results) {
    const row = rows.find(candidate => candidate.commandId === result.commandId)
    if (!row) continue
    if (result.status === 'applied' || result.status === 'conflict') {
      const command = JSON.parse(row.payload) as {
        type?: string; objectId?: string; documentId?: string; updateId?: string
        checkpointId?: string; keyVersion?: number; ciphertext?: string; coversDocumentSequence?: string
        ciphertextHash?: string; kind?: SyncObjectKind
      }
      await database.execute(
        "update self_hosted_outbox set state = 'sent', updated_at = $1, last_error_code = null where command_id = $2",
        [Date.now(), row.commandId]
      )
      for (const id of JSON.parse(row.sourceChangeIds) as number[]) {
        await database.execute(
          "update self_hosted_local_changes set state = 'sent', updated_at = $1 where id = $2",
          [Date.now(), id]
        )
      }
      if (command.objectId && result.revision && result.sequence) {
        if (result.status === 'applied') {
          await recordAppliedCommandRevision(
            binding,
            command,
            result.revision,
            result.sequence,
          )
        } else {
          await recordRevision(
            binding.workspaceId,
            command.objectId,
            result.revision,
            result.sequence,
            command.ciphertextHash ?? '',
          )
        }
        await database.execute(
          `update self_hosted_outbox set state = 'pending', updated_at = $1
           where workspace_id = $2 and state = 'blocked'
             and json_extract(payload, '$.objectId') = $3`,
          [Date.now(), binding.workspaceId, command.objectId]
        )
        if (command.type === 'upsert-object') activatedCollaborativeObject = true
      }
      if (result.status === 'applied' && command.type === 'delete-object' && command.objectId) {
        await database.execute(
          `update self_hosted_object_mappings set deleted_at = $1, updated_at = $1
           where workspace_id = $2 and object_id = $3`,
          [Date.now(), binding.workspaceId, command.objectId]
        )
      }
      if (result.status === 'applied' && command.type === 'upsert-object' && command.objectId) {
        await database.execute(
          `update self_hosted_object_mappings set deleted_at = null, updated_at = $1
           where workspace_id = $2 and object_id = $3`,
          [Date.now(), binding.workspaceId, command.objectId]
        )
      }
      if (result.conflictId) await recordProtocolConflict(binding.workspaceId, command.objectId, result.conflictId)
      if (result.documentSequence && command.documentId && command.ciphertext) {
        await database.execute(
          `insert or replace into self_hosted_yjs_updates(
             workspace_id, document_id, document_sequence, object_id, key_version,
             event_type, update_id, payload, applied, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
          [
            binding.workspaceId, command.documentId, result.documentSequence,
            command.objectId, command.keyVersion ?? 1,
            command.type === 'commit-checkpoint' ? 'checkpoint' : 'update',
            command.updateId ?? command.checkpointId ?? row.commandId,
            command.ciphertext, Date.now(),
          ]
        )
      }
      if (command.type === 'commit-checkpoint' && command.documentId && command.coversDocumentSequence) {
        await database.execute(
          `delete from self_hosted_yjs_updates where workspace_id = $1 and document_id = $2
             and cast(document_sequence as integer) <= cast($3 as integer) and event_type = 'update'`,
          [binding.workspaceId, command.documentId, command.coversDocumentSequence]
        )
      }
    } else {
      const retry = result.retryable === true && result.code !== 'checkpoint_not_current'
      const rejectedState = result.code === 'checkpoint_not_current' ? 'superseded' : 'failed'
      if (!retry) {
        for (const id of JSON.parse(row.sourceChangeIds) as number[]) {
          await database.execute(
            "update self_hosted_local_changes set state = 'superseded', updated_at = $1 where id = $2",
            [Date.now(), id],
          )
        }
      }
      // Finish source rows before terminally rejecting their outbox command.
      // If the process stops between these writes, the still-retryable command
      // remains recoverable instead of stranding queued source rows forever.
      await database.execute(
        `update self_hosted_outbox set state = $1, attempt_count = attempt_count + 1,
           next_attempt_at = $2, last_error_code = $3, updated_at = $4 where command_id = $5`,
        [retry ? 'retry' : rejectedState, retry ? Date.now() + retryDelay(row.attemptCount) : 0, result.code ?? 'rejected', Date.now(), row.commandId]
      )
    }
  }
  return activatedCollaborativeObject
}

function parseOutboxCommand(payload: string) {
  const command = JSON.parse(payload) as Record<string, unknown>
  let changed = false
  if (command.nameBlindIndexKeyVersion === null) {
    delete command.nameBlindIndexKeyVersion
    changed = true
  }
  return { command, changed }
}

async function pullEvents(binding: Binding, session: SyncSession) {
  const database = await getDb()
  const { client } = await authenticatedClient(binding.profileId)
  let cursor = binding.pulledSequence
  let hasMore = true
  while (hasMore) {
    const page = await client.events(
      binding.workspaceId, cursor, Math.min(500, session.limits.maxEventsPerPage), session.syncEpoch,
    )
    for (const event of page.events) {
      await database.execute(
        `insert or ignore into self_hosted_inbox(
           workspace_id, event_id, sequence, payload, state, received_at
         ) values ($1, $2, $3, $4, 'pending', $5)`,
        [binding.workspaceId, event.eventId, event.sequence, JSON.stringify(event), Date.now()]
      )
    }
    cursor = page.nextCursor
    hasMore = page.hasMore
    await updatePulledCursor(binding.workspaceId, cursor)
  }
}

async function applyInbox(
  binding: Binding,
  deviceId: string | null,
  isDocumentSubscribed: (objectId: string) => boolean,
): Promise<string> {
  const database = await getDb()
  const rows = await database.select<Array<{ sequence: string; payload: string }>>(
    `select sequence, payload from self_hosted_inbox
     where workspace_id = $1 and state in ('pending', 'failed')
       and cast(sequence as integer) > cast($2 as integer)
     order by cast(sequence as integer)`,
    [binding.workspaceId, binding.appliedSequence]
  )
  const parsedRows = rows.map(row => ({
    ...row,
    event: JSON.parse(row.payload) as SyncEvent,
  }))
  // Object upserts and deletes are complete encrypted snapshots. When a device
  // reconnects after a burst of edits, applying every intermediate snapshot
  // causes thousands of redundant fsyncs and can prevent mobile clients from
  // ever reaching the current state. Keep durable cursor continuity, but only
  // materialize the newest snapshot for each object in this pending batch.
  const latestSnapshotSequence = new Map<string, string>()
  for (const row of parsedRows) {
    if (isCoalescibleSnapshot(row.event)) {
      latestSnapshotSequence.set(row.event.objectId!, row.sequence)
    }
  }
  let through = binding.appliedSequence
  let coalesced = 0
  let bindingStoresChanged = false
  for (const row of parsedRows) {
    const event = row.event
    try {
      const supersededSnapshot = isCoalescibleSnapshot(event)
        && latestSnapshotSequence.get(event.objectId!) !== row.sequence
      if (!supersededSnapshot) {
        if (event.sourceDeviceId !== deviceId) {
          const collaborativeSnapshotEcho = event.type === 'object.upserted'
            && event.objectId !== null
            && event.metadata.kind === 'note'
            && isDocumentSubscribed(event.objectId)
          if (collaborativeSnapshotEcho) {
            console.info('[self-hosted-sync] Deferred remote note snapshot to active collaboration', {
              workspaceId: binding.workspaceId,
              objectId: event.objectId,
              sequence: event.sequence,
            })
          } else {
            await applyRemoteEvent(binding, event)
            if (isCoalescibleSnapshot(event)) bindingStoresChanged = true
          }
        }
        await recordEventRevision(binding.workspaceId, event)
      } else {
        coalesced += 1
      }
      await database.execute(
        "update self_hosted_inbox set state = 'applied', applied_at = $1, error_code = null where workspace_id = $2 and sequence = $3",
        [Date.now(), binding.workspaceId, event.sequence]
      )
      through = event.sequence
    } catch (error) {
      await database.execute(
        "update self_hosted_inbox set state = 'failed', error_code = $1 where workspace_id = $2 and sequence = $3",
        [String(error instanceof Error ? error.message : error).slice(0, 120), binding.workspaceId, event.sequence]
      )
      break
    }
  }
  await cleanupDeletedFolders(binding)
  await updateAppliedCursor(binding.workspaceId, through)
  if (coalesced > 0) {
    console.info('[self-hosted-sync] inbox snapshots coalesced', {
      workspaceId: binding.workspaceId,
      coalesced,
      received: rows.length,
      appliedThrough: through,
    })
  }
  if (bindingStoresChanged) await refreshBindingStores(binding)
  return through
}

function isCoalescibleSnapshot(event: SyncEvent): boolean {
  return Boolean(
    event.objectId
    && (event.type === 'object.upserted' || event.type === 'object.deleted')
  )
}

async function refreshBindingStores(binding: Binding) {
  if (binding.workspaceType === 'library') {
    await refreshLibraryFileTree(binding)
    return
  }
  try {
    const [{ default: useMarkStore }, { default: useTagStore }, { default: useCanvasStore }, { default: useChatStore }] = await Promise.all([
      import('@/stores/mark'),
      import('@/stores/tag'),
      import('@/stores/canvas'),
      import('@/stores/chat'),
    ])
    const markState = useMarkStore.getState()
    const chatState = useChatStore.getState()
    const currentConversationId = chatState.currentConversationId
    await Promise.all([
      markState.fetchAllMarks(),
      markState.trashState ? markState.fetchAllTrashMarks() : markState.fetchMarks(),
      useTagStore.getState().fetchTags(),
      useCanvasStore.getState().loadProjects(),
      chatState.initConversations(),
    ])
    if (currentConversationId && useChatStore.getState().conversations.some(item => item.id === currentConversationId)) {
      await useChatStore.getState().switchConversation(currentConversationId)
    } else if (currentConversationId) {
      useChatStore.setState({ currentConversationId: null, chats: [] })
    }
  } catch (error) {
    console.warn('[self-hosted-sync] Unable to refresh personal data stores', {
      workspaceId: binding.workspaceId,
      error,
    })
  }
}

async function refreshLibraryFileTree(binding: Binding) {
  if (binding.workspaceType !== 'library' || !binding.localRoot) return
  try {
    const { default: useArticleStore } = await import('@/stores/article')
    await useArticleStore.getState().loadFileTree({ skipRemoteSync: true })
  } catch (error) {
    console.warn('[self-hosted-sync] Unable to refresh the local file tree', {
      workspaceId: binding.workspaceId,
      error,
    })
  }
}

async function applyRemoteEvent(binding: Binding, event: SyncEvent) {
  const database = await getDb()
  if (event.type === 'conflict.created' || event.type === 'conflict.resolved') {
    if (event.type === 'conflict.created') {
      const conflictId = String(event.metadata.conflictId ?? event.eventId)
      await recordProtocolConflict(binding.workspaceId, event.objectId ?? undefined, conflictId)
    }
    return
  }
  if (!event.objectId) return
  if (binding.workspaceType === 'library') {
    if (event.metadata.kind === 'canvas') return
    if (event.type === 'object.deleted' || event.type === 'document.updated' || event.type === 'document.checkpointed') {
      const legacyCanvasMappings = await database.select<Array<{ objectId: string }>>(
        `select object_id as objectId from self_hosted_object_mappings
         where workspace_id = $1 and object_id = $2 and kind = 'canvas' limit 1`,
        [binding.workspaceId, event.objectId]
      )
      if (legacyCanvasMappings.length > 0) return
    }
  }
  if (event.type === 'object.deleted') {
    await applyRemoteDelete(binding, await resolveRemoteDeleteTarget(binding, event))
    return
  }
  if (event.type === 'document.updated' || event.type === 'document.checkpointed') {
    if (!event.documentId || !event.documentSequence || !event.ciphertext) return
    await database.execute(
      `insert or ignore into self_hosted_yjs_updates(
         workspace_id, document_id, document_sequence, object_id, key_version,
         event_type, update_id, payload, applied, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)`,
      [
        binding.workspaceId, event.documentId, event.documentSequence, event.objectId,
        event.keyVersion, event.type === 'document.checkpointed' ? 'checkpoint' : 'update',
        event.commandId, event.ciphertext, Date.now(),
      ]
    )
    return
  }
  if (!event.ciphertext || !event.keyVersion) throw new Error('remote_ciphertext_missing')
  const kind = String(event.metadata.kind ?? 'note')
  const key = await loadWorkspaceKey(binding.workspaceId, event.keyVersion)
  const payload = await decryptPackedJson<Record<string, unknown>>(
    key, event.ciphertext, objectAssociatedData(binding.workspaceId, event.objectId, kind),
  )
  if (binding.workspaceType === 'library' && payload.domain === 'canvas') return
  if (payload.domain === 'file' && binding.localRoot) {
    await applyRemoteFile(binding, event, payload)
    return
  }
  if (payload.domain === 'asset' && binding.localRoot) {
    await applyRemoteAsset(binding, event, payload)
    return
  }
  if (payload.domain === 'folder' && binding.localRoot) {
    await applyRemoteFolder(binding, event, payload)
    return
  }
  await applyStructuredPayload(binding.workspaceId, event.objectId, kind as SyncObjectKind, payload)
  await database.execute(
    `insert into self_hosted_remote_objects(workspace_id, object_id, kind, revision, payload, updated_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict(workspace_id, object_id) do update set
       kind = excluded.kind, revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at`,
    [binding.workspaceId, event.objectId, kind, String(event.metadata.revision ?? '0'), JSON.stringify(payload), Date.now()]
  )
}

async function resolveRemoteDeleteTarget(binding: Binding, event: SyncEvent) {
  const database = await getDb()
  const direct = await database.select<Array<{ objectId: string }>>(
    `select object_id as objectId from self_hosted_object_mappings
     where workspace_id = $1 and object_id = $2 limit 1`,
    [binding.workspaceId, event.objectId]
  )
  if (direct[0]) return direct[0].objectId
  if (!event.ciphertext || !event.keyVersion) return event.objectId!
  const kind = String(event.metadata.kind ?? 'note') as SyncObjectKind
  const key = await loadWorkspaceKey(binding.workspaceId, event.keyVersion)
  const payload = await decryptPackedJson<Record<string, unknown>>(
    key,
    event.ciphertext,
    objectAssociatedData(binding.workspaceId, event.objectId!, kind),
  )
  const domain = String(payload.domain ?? '')
  const localKey = String(payload.relativePath ?? payload.localKey ?? '')
  if (!domain || !localKey) return event.objectId!
  const portable = ['file', 'asset', 'folder'].includes(domain)
    ? await invoke<PortableMappingPath>('self_hosted_portable_path', { relativePath: localKey })
    : null
  const normalizedLocalKey = portable?.normalized ?? localKey
  const localIdentity = `${domain}:${normalizedLocalKey}`
  const existing = await database.select<Array<{ objectId: string }>>(
    `select object_id as objectId from self_hosted_object_mappings
     where workspace_id = $1 and (
       (kind = $2 and local_identity = $3)
       or ($4 is not null and path_casefold = $4 and deleted_at is null)
     ) limit 1`,
    [binding.workspaceId, kind, localIdentity, portable?.caseFolded ?? null]
  )
  if (existing[0]) return existing[0].objectId
  await database.execute(
    `insert into self_hosted_object_mappings(
       workspace_id, object_id, kind, local_identity, relative_path, path_casefold,
       deleted_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, null, $7)`,
    [
      binding.workspaceId, event.objectId, kind, localIdentity,
      portable?.normalized ?? null, portable?.caseFolded ?? null, Date.now(),
    ]
  )
  return event.objectId!
}

interface PortableMappingPath {
  normalized: string
  caseFolded: string
}

async function convergeRemotePortableMapping(
  binding: Binding,
  event: SyncEvent,
  kind: Extract<SyncObjectKind, 'note' | 'asset' | 'folder'>,
  domain: 'file' | 'asset' | 'folder',
  portable: PortableMappingPath,
) {
  const database = await getDb()
  const localIdentity = `${domain}:${portable.normalized}`
  const [incomingRows, conflictingRows] = await Promise.all([
    database.select<Array<{ contentHash: string | null; blobRefs: string }>>(
      `select content_hash as contentHash, blob_refs as blobRefs
       from self_hosted_object_mappings
       where workspace_id = $1 and object_id = $2 limit 1`,
      [binding.workspaceId, event.objectId]
    ),
    database.select<Array<{
      objectId: string
      kind: string
      localIdentity: string
      relativePath: string | null
      pathCasefold: string | null
      contentHash: string | null
      blobRefs: string
      deletedAt: number | null
    }>>(
      `select object_id as objectId, kind, local_identity as localIdentity,
         relative_path as relativePath, path_casefold as pathCasefold,
         content_hash as contentHash, blob_refs as blobRefs, deleted_at as deletedAt
       from self_hosted_object_mappings
       where workspace_id = $1 and object_id <> $2 and (
         (kind = $3 and local_identity = $4)
         or (path_casefold = $5 and deleted_at is null)
       )`,
      [binding.workspaceId, event.objectId, kind, localIdentity, portable.caseFolded]
    ),
  ])
  const now = Date.now()
  for (const conflicting of conflictingRows) {
    // Keep a retired row for the old object id so a delayed delete event targets
    // that object instead of resolving by path to the new authoritative object.
    await database.execute(
      `update self_hosted_object_mappings
       set local_identity = $1, relative_path = null, path_casefold = null,
         deleted_at = coalesce(deleted_at, $2), updated_at = $2
       where workspace_id = $3 and object_id = $4`,
      [
        `superseded:${conflicting.kind}:${conflicting.objectId}`,
        now,
        binding.workspaceId,
        conflicting.objectId,
      ]
    )
  }
  const inherited = incomingRows[0]
    ?? conflictingRows.find(row => row.kind === kind && row.localIdentity === localIdentity)
    ?? conflictingRows[0]
  try {
    await database.execute(
      `insert into self_hosted_object_mappings(
         workspace_id, object_id, kind, local_identity, relative_path, path_casefold,
         content_hash, blob_refs, deleted_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, null, $9)
       on conflict(workspace_id, object_id) do update set
         kind = excluded.kind, local_identity = excluded.local_identity,
         relative_path = excluded.relative_path, path_casefold = excluded.path_casefold,
         content_hash = coalesce(self_hosted_object_mappings.content_hash, excluded.content_hash),
         blob_refs = case when self_hosted_object_mappings.blob_refs = '[]'
           then excluded.blob_refs else self_hosted_object_mappings.blob_refs end,
         deleted_at = null, updated_at = excluded.updated_at`,
      [
        binding.workspaceId,
        event.objectId,
        kind,
        localIdentity,
        portable.normalized,
        portable.caseFolded,
        inherited?.contentHash ?? null,
        inherited?.blobRefs ?? '[]',
        now,
      ]
    )
  } catch (error) {
    // The two statements cannot share a portable transaction through the SQL
    // plugin, so restore every retired row before surfacing the apply failure.
    for (const conflicting of conflictingRows) {
      await database.execute(
        `update self_hosted_object_mappings set kind = $1, local_identity = $2,
           relative_path = $3, path_casefold = $4, content_hash = $5,
           blob_refs = $6, deleted_at = $7, updated_at = $8
         where workspace_id = $9 and object_id = $10`,
        [
          conflicting.kind,
          conflicting.localIdentity,
          conflicting.relativePath,
          conflicting.pathCasefold,
          conflicting.contentHash,
          conflicting.blobRefs,
          conflicting.deletedAt,
          now,
          binding.workspaceId,
          conflicting.objectId,
        ],
      )
    }
    throw error
  }

  for (const conflicting of conflictingRows) {
    const pendingCommands = await database.select<Array<{
      commandId: string
      sourceChangeIds: string
    }>>(
      `select command_id as commandId, source_change_ids as sourceChangeIds
       from self_hosted_outbox where workspace_id = $1
         and state in ('pending', 'retry', 'blocked')
         and json_extract(payload, '$.objectId') = $2`,
      [binding.workspaceId, conflicting.objectId],
    )
    for (const command of pendingCommands) {
      await database.execute(
        `update self_hosted_outbox set state = 'superseded', next_attempt_at = 0,
           last_error_code = 'mapping_superseded_requeue', updated_at = $1
         where command_id = $2`,
        [Date.now(), command.commandId],
      )
      for (const sourceId of JSON.parse(command.sourceChangeIds) as number[]) {
        await database.execute(
          `update self_hosted_local_changes set state = 'pending', updated_at = $1
           where id = $2 and state = 'queued'`,
          [Date.now(), sourceId],
        )
      }
    }
  }
}

async function applyRemoteAsset(binding: Binding, event: SyncEvent, payload: Record<string, unknown>) {
  const relativePath = String(payload.relativePath ?? '')
  const blobId = String(payload.blobId ?? '')
  if (!relativePath || !blobId) throw new Error('remote_asset_invalid')
  const portable = await invoke<PortableMappingPath>('self_hosted_portable_path', { relativePath })
  const downloaded = await downloadAsset({
    profileId: binding.profileId,
    workspaceId: binding.workspaceId,
    blobId,
    relativePath,
    keyVersion: event.keyVersion ?? 1,
  })
  await convergeRemotePortableMapping(binding, event, 'asset', 'asset', portable)
  const database = await getDb()
  const mappings = await database.select<Array<{ contentHash: string | null }>>(
    `select content_hash as contentHash from self_hosted_object_mappings
     where workspace_id = $1 and object_id = $2 limit 1`,
    [binding.workspaceId, event.objectId]
  )
  const absolutePath = await join(binding.localRoot!, portable.normalized)
  if (await exists(absolutePath) && mappings[0]?.contentHash) {
    const current = await readFile(absolutePath)
    if (await hashBytes(current) !== mappings[0].contentHash) {
      const conflictPath = conflictCopyPath(portable.normalized)
      await writeBytesJournaled(binding, event.objectId!, conflictPath, current)
      await database.execute(
        `insert into self_hosted_conflicts(
           id, workspace_id, object_id, conflict_type, local_copy_path, state, created_at
         ) values ($1, $2, $3, 'snapshot-diverged', $4, 'unresolved', $5)`,
        [crypto.randomUUID(), binding.workspaceId, event.objectId, conflictPath, Date.now()]
      )
    }
  }
  await writeBytesJournaled(binding, event.objectId!, portable.normalized, downloaded.bytes)
  await database.execute(
    `insert into self_hosted_object_mappings(
       workspace_id, object_id, kind, local_identity, relative_path, path_casefold,
       content_hash, blob_refs, deleted_at, updated_at
     ) values ($1, $2, 'asset', $3, $4, $5, $6, $7, null, $8)
     on conflict(workspace_id, object_id) do update set
       kind = excluded.kind, local_identity = excluded.local_identity,
       relative_path = excluded.relative_path, path_casefold = excluded.path_casefold,
       content_hash = excluded.content_hash, blob_refs = excluded.blob_refs,
       deleted_at = null, updated_at = excluded.updated_at`,
    [
      binding.workspaceId, event.objectId, `asset:${portable.normalized}`, portable.normalized,
      portable.caseFolded, downloaded.hash, JSON.stringify([blobId]), Date.now(),
    ]
  )
}

async function applyRemoteFolder(binding: Binding, event: SyncEvent, payload: Record<string, unknown>) {
  const relativePath = String(payload.relativePath ?? '')
  if (!relativePath) throw new Error('remote_folder_invalid')
  const portable = await invoke<{ normalized: string; caseFolded: string }>(
    'self_hosted_portable_path', { relativePath },
  )
  await invoke('self_hosted_create_directory', {
    workspaceId: binding.workspaceId,
    objectId: event.objectId,
    workspaceRoot: binding.localRoot,
    relativePath: portable.normalized,
  })
  await convergeRemotePortableMapping(binding, event, 'folder', 'folder', portable)
  const database = await getDb()
  await database.execute(
    `insert into self_hosted_object_mappings(
       workspace_id, object_id, kind, local_identity, relative_path, path_casefold, updated_at
     ) values ($1, $2, 'folder', $3, $4, $5, $6)
     on conflict(workspace_id, object_id) do update set kind = excluded.kind,
       local_identity = excluded.local_identity, relative_path = excluded.relative_path,
       path_casefold = excluded.path_casefold, deleted_at = null, updated_at = excluded.updated_at`,
    [
      binding.workspaceId, event.objectId, `folder:${portable.normalized}`,
      portable.normalized, portable.caseFolded, Date.now(),
    ]
  )
}

async function hasUnsentPortableUpsert(
  workspaceId: string,
  kind: string,
  relativePath: string,
) {
  const domain = kind === 'note' ? 'file' : kind
  if (!['file', 'asset', 'folder'].includes(domain)) return false
  const rows = await (await getDb()).select<Array<{ id: number }>>(
    `select id from self_hosted_local_changes
     where workspace_id = $1 and domain = $2 and local_key = $3
       and operation = 'upsert' and state in ('pending', 'queued') limit 1`,
    [workspaceId, domain, relativePath],
  )
  return rows.length > 0
}

async function applyRemoteDelete(binding: Binding, objectId: string) {
  const database = await getDb()
  const mappings = await database.select<Array<{
    relativePath: string | null
    contentHash: string | null
    kind: string
  }>>(
    `select relative_path as relativePath, content_hash as contentHash, kind
     from self_hosted_object_mappings where workspace_id = $1 and object_id = $2 limit 1`,
    [binding.workspaceId, objectId]
  )
  const mapping = mappings[0]
  if (mapping?.relativePath && binding.localRoot) {
    const absolutePath = await join(binding.localRoot, mapping.relativePath)
    const pathExists = await exists(absolutePath)
    const fileExists = mapping.kind !== 'folder' && pathExists
    if (
      pathExists
      && await hasUnsentPortableUpsert(
        binding.workspaceId,
        mapping.kind,
        mapping.relativePath,
      )
    ) {
      await preserveRemoteDeleteLocalFile(binding, objectId, mapping.kind, mapping.relativePath)
      return
    }
    if (fileExists && !mapping.contentHash) {
      await database.execute(
        `insert into self_hosted_conflicts(
           id, workspace_id, object_id, conflict_type, local_copy_path, state, created_at
         ) values ($1, $2, $3, 'remote-delete-local-edit', $4, 'unresolved', $5)`,
        [crypto.randomUUID(), binding.workspaceId, objectId, mapping.relativePath, Date.now()],
      )
      await preserveRemoteDeleteLocalFile(binding, objectId, mapping.kind, mapping.relativePath)
      return
    }
    if (fileExists && mapping.contentHash) {
      const current = mapping.kind === 'asset' ? null : await readTextFile(absolutePath)
      const currentHash = mapping.kind === 'asset'
        ? await hashBytes(await readFile(absolutePath))
        : await invoke<string>('self_hosted_sha256', { value: current! })
      if (currentHash !== mapping.contentHash) {
        await database.execute(
          `insert into self_hosted_conflicts(
             id, workspace_id, object_id, conflict_type, local_snapshot,
             local_copy_path, state, created_at
           ) values ($1, $2, $3, 'remote-delete-local-edit', $4, $5, 'unresolved', $6)`,
          [crypto.randomUUID(), binding.workspaceId, objectId, current, mapping.relativePath, Date.now()]
        )
        await preserveRemoteDeleteLocalFile(binding, objectId, mapping.kind, mapping.relativePath)
        return
      }
    }
    if (mapping.kind === 'note') {
      await deleteRemoteEditorFile(
        binding,
        objectId,
        mapping.relativePath,
        mapping.contentHash,
      )
    } else if (mapping.kind === 'asset' && fileExists && mapping.contentHash) {
      await invoke<boolean>('self_hosted_delete_file', {
        workspaceId: binding.workspaceId,
        objectId,
        workspaceRoot: binding.localRoot,
        relativePath: mapping.relativePath,
        expectedHash: mapping.contentHash,
      })
    }
  }
  if (!mapping?.relativePath) await deleteStructuredObject(binding.workspaceId, objectId)
  await database.execute(
    `update self_hosted_object_mappings set deleted_at = $1, updated_at = $1
     where workspace_id = $2 and object_id = $3`,
    [Date.now(), binding.workspaceId, objectId]
  )
}

async function preserveRemoteDeleteLocalFile(
  binding: Binding,
  objectId: string,
  kind: string,
  relativePath: string,
) {
  await (await getDb()).execute(
    `update self_hosted_object_mappings set deleted_at = null, updated_at = $1
     where workspace_id = $2 and object_id = $3`,
    [Date.now(), binding.workspaceId, objectId],
  )
  if (kind === 'note') {
    await enqueueFileSnapshot(relativePath, 'upsert', binding.workspaceId)
  } else if (kind === 'asset') {
    await enqueueAssetSnapshot(relativePath, 'upsert', binding.workspaceId)
  } else if (kind === 'folder') {
    await enqueueFolderSnapshot(relativePath, 'upsert', binding.workspaceId)
  }
}

async function cleanupDeletedFolders(binding: Binding) {
  if (!binding.localRoot) return
  const database = await getDb()
  const folders = await database.select<Array<{ objectId: string; relativePath: string }>>(
    `select object_id as objectId, relative_path as relativePath
     from self_hosted_object_mappings where workspace_id = $1 and kind = 'folder'
       and deleted_at is not null and relative_path is not null
     order by length(relative_path) desc`,
    [binding.workspaceId]
  )
  const { default: useArticleStore } = await import('@/stores/article')
  for (const folder of folders) {
    try {
      const articleState = useArticleStore.getState()
      if (!await prepareActiveEditorPathMutationDurably(
        articleState.activeFilePath,
        [folder.relativePath],
      )) {
        throw new Error('remote_folder_editor_busy')
      }
      await articleState.cleanTabsByDeletedFolder(folder.relativePath, binding.localRoot)
      await invoke<boolean>('self_hosted_delete_directory', {
        workspaceId: binding.workspaceId,
        objectId: folder.objectId,
        workspaceRoot: binding.localRoot,
        relativePath: folder.relativePath,
      })
    } catch {
      const existing = await database.select<Array<{ id: string }>>(
        `select id from self_hosted_conflicts where workspace_id = $1 and object_id = $2
           and conflict_type = 'remote-delete-local-edit' and state = 'unresolved' limit 1`,
        [binding.workspaceId, folder.objectId]
      )
      if (existing.length === 0) {
        await database.execute(
          `insert into self_hosted_conflicts(
             id, workspace_id, object_id, conflict_type, local_copy_path, state, created_at
           ) values ($1, $2, $3, 'remote-delete-local-edit', $4, 'unresolved', $5)`,
          [crypto.randomUUID(), binding.workspaceId, folder.objectId, folder.relativePath, Date.now()]
        )
      }
    }
  }
}

async function applyRemoteFile(binding: Binding, event: SyncEvent, payload: Record<string, unknown>) {
  const relativePath = String(payload.relativePath ?? '')
  const blobId = typeof payload.blobId === 'string' ? payload.blobId : null
  const downloaded = blobId ? await downloadAsset({
    profileId: binding.profileId,
    workspaceId: binding.workspaceId,
    blobId,
    relativePath,
    keyVersion: event.keyVersion ?? 1,
  }) : null
  const content = downloaded ? new TextDecoder().decode(downloaded.bytes) : String(payload.content ?? '')
  const portable = await invoke<PortableMappingPath>('self_hosted_portable_path', { relativePath })
  const database = await getDb()
  const previousMappings = await database.select<Array<{ deletedAt: number | null }>>(
    `select deleted_at as deletedAt from self_hosted_object_mappings
     where workspace_id = $1 and object_id = $2 limit 1`,
    [binding.workspaceId, event.objectId],
  )
  const hadUnsentLocalUpsert = await hasUnsentPortableUpsert(
    binding.workspaceId,
    'note',
    portable.normalized,
  )
  const distrustStoredBase = typeof previousMappings[0]?.deletedAt === 'number'
    || hadUnsentLocalUpsert
  await convergeRemotePortableMapping(binding, event, 'note', 'file', portable)
  const expectedHash = downloaded?.hash ?? await invoke<string>('self_hosted_sha256', { value: content })
  const appliedSnapshot = await writeRemoteEditorSnapshot(
    binding,
    event.objectId!,
    portable.normalized,
    async (currentContent) => {
      if (currentContent === null) {
        return { content, merged: false, conflict: null }
      }

      const mappings = await database.select<Array<{ contentHash: string | null }>>(
        `select content_hash as contentHash from self_hosted_object_mappings
         where workspace_id = $1 and object_id = $2 limit 1`,
        [binding.workspaceId, event.objectId],
      )
      const currentHash = await invoke<string>('self_hosted_sha256', { value: currentContent })
      const diverged = distrustStoredBase
        ? currentHash !== expectedHash
        : mappings[0]?.contentHash
          ? currentHash !== mappings[0].contentHash
          : currentHash !== expectedHash
      if (!diverged) {
        return { content, merged: false, conflict: null }
      }

      const bases = await database.select<Array<{ snapshot: string | null }>>(
        `select snapshot from self_hosted_revisions where workspace_id = $1 and object_id = $2
         order by cast(revision as integer) desc limit 1`,
        [binding.workspaceId, event.objectId],
      )
      const baseSnapshot = bases[0]?.snapshot ?? null
      const merged = baseSnapshot === null
        ? null
        : mergeTextSnapshots(baseSnapshot, currentContent, content)
      if (merged !== null) {
        return { content: merged, merged: true, conflict: null }
      }

      return {
        content,
        merged: false,
        conflict: {
          localSnapshot: currentContent,
          baseSnapshot,
          localCopyPath: conflictCopyPath(portable.normalized),
        },
      }
    },
  )
  await database.execute(
    `insert into self_hosted_object_mappings(
       workspace_id, object_id, kind, local_identity, relative_path, path_casefold,
       content_hash, blob_refs, deleted_at, updated_at
     ) values ($1, $2, 'note', $3, $4, $5, $6, $7, null, $8)
     on conflict(workspace_id, object_id) do update set
       kind = excluded.kind, local_identity = excluded.local_identity,
       relative_path = excluded.relative_path, path_casefold = excluded.path_casefold,
       content_hash = excluded.content_hash, blob_refs = excluded.blob_refs,
       deleted_at = null, updated_at = excluded.updated_at`,
    [
      binding.workspaceId, event.objectId, `file:${portable.normalized}`, portable.normalized,
      portable.caseFolded, expectedHash, JSON.stringify(blobId ? [blobId] : []), Date.now(),
    ]
  )
  if (typeof event.metadata.revision === 'string') {
    await database.execute(
      `insert or replace into self_hosted_revisions(
         workspace_id, object_id, revision, sequence, content_hash, snapshot, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        binding.workspaceId, event.objectId, event.metadata.revision, event.sequence,
        expectedHash, content, Date.now(),
      ]
    )
  }
  if (appliedSnapshot.conflict) {
    await database.execute(
      `insert into self_hosted_conflicts(
         id, workspace_id, object_id, conflict_type, local_snapshot, remote_snapshot,
         base_snapshot, local_copy_path, state, created_at
       ) values ($1, $2, $3, 'snapshot-diverged', $4, $5, $6, $7, 'unresolved', $8)`,
      [
        crypto.randomUUID(),
        binding.workspaceId,
        event.objectId,
        appliedSnapshot.conflict.localSnapshot,
        content,
        appliedSnapshot.conflict.baseSnapshot,
        appliedSnapshot.conflict.localCopyPath,
        Date.now(),
      ],
    )
    await enqueueFileSnapshot(
      appliedSnapshot.conflict.localCopyPath,
      'upsert',
      binding.workspaceId,
    )
  }
  if (appliedSnapshot.merged) {
    // Keep the remote hash as the merge base until this local merge is
    // accepted by the server. Updating it early would hide a later conflict.
    await enqueueFileSnapshot(portable.normalized, 'upsert', binding.workspaceId)
  }
}

async function bootstrapBinding(binding: Binding, session: SyncSession) {
  const { client } = await authenticatedClient(binding.profileId)
  let bootstrapId: string | undefined
  let afterObjectId: string | undefined
  let snapshotSequence = '0'
  const objects: SyncBootstrapPage['objects'] = []
  const conflicts: Array<Record<string, unknown>> = []
  do {
    const page = await client.bootstrap(
      binding.workspaceId,
      session.syncEpoch,
      bootstrapId,
      afterObjectId,
      session.limits.maxBootstrapObjectsPerPage,
    )
    bootstrapId = page.bootstrapId
    snapshotSequence = page.snapshotSequence
    objects.push(...page.objects)
    conflicts.push(...page.conflicts)
    afterObjectId = page.nextObjectId ?? undefined
  } while (afterObjectId)
  const priority: Partial<Record<SyncObjectKind, number>> = {
    tag: 0, conversation: 0, folder: 0,
    mark: 1, note: 1, message: 1, asset: 1, canvas: 1,
  }
  objects.sort((left, right) => {
    const deletionOrder = Number(left.deletedAt === null) - Number(right.deletedAt === null)
    if (deletionOrder !== 0) return deletionOrder
    return (priority[left.kind] ?? 2) - (priority[right.kind] ?? 2)
  })
  let skippedObjects = 0
  for (const object of objects) {
    const event: SyncEvent = {
      eventId: `bootstrap:${bootstrapId}:${object.objectId}`,
      sequence: snapshotSequence,
      commandId: `bootstrap:${object.objectId}`,
      sourceDeviceId: '',
      type: object.deletedAt ? 'object.deleted' : 'object.upserted',
      objectId: object.objectId,
      documentId: object.document?.documentId ?? null,
      documentSequence: object.document?.latestDocumentSequence ?? null,
      keyVersion: object.keyVersion,
      ciphertext: object.ciphertext,
      ciphertextHash: object.ciphertextHash,
      metadata: { kind: object.kind, revision: object.currentRevision },
      createdAt: new Date().toISOString(),
    }
    try {
      await applyRemoteEvent(binding, event)
    } catch (error) {
      skippedObjects += 1
      try {
        await recordBootstrapApplyFailure(binding.workspaceId, object.objectId, object.kind, error)
      } catch (recordError) {
        console.warn('[self-hosted-sync] Unable to record bootstrap object failure', {
          workspaceId: binding.workspaceId,
          objectId: object.objectId,
          recordError,
        })
      }
      console.warn('[self-hosted-sync] Bootstrap object could not be applied', {
        workspaceId: binding.workspaceId,
        workspaceType: binding.workspaceType,
        objectId: object.objectId,
        kind: object.kind,
        error,
      })
      continue
    }
    await recordRevision(
      binding.workspaceId,
      object.objectId,
      object.currentRevision,
      snapshotSequence,
      object.ciphertextHash,
    )
    if (object.document?.checkpointCiphertext) {
      await (await getDb()).execute(
          `insert or replace into self_hosted_yjs_updates(
             workspace_id, document_id, document_sequence, object_id, key_version,
             event_type, update_id, payload, applied, created_at
           ) values ($1, $2, $3, $4, $5, 'checkpoint', $6, $7, 0, $8)`,
          [
            binding.workspaceId,
            object.document.documentId,
            object.document.checkpointDocumentSequence,
            object.objectId,
            object.document.checkpointKeyVersion,
            object.document.checkpointId,
            object.document.checkpointCiphertext,
            Date.now(),
          ]
      )
    }
  }
  if (skippedObjects > 0) {
    console.warn('[self-hosted-sync] Bootstrap completed with isolated object failures', {
      workspaceId: binding.workspaceId,
      workspaceType: binding.workspaceType,
      skippedObjects,
      totalObjects: objects.length,
    })
  }
  const isolatedFailureLimit = Math.max(3, Math.ceil(objects.length * 0.1))
  if (skippedObjects > isolatedFailureLimit) {
    throw new Error(
      `bootstrap_apply_failure_limit_exceeded:${skippedObjects}/${objects.length}`,
    )
  }
  for (const conflict of conflicts) {
    await recordProtocolConflict(
      binding.workspaceId,
      typeof conflict.objectId === 'string' ? conflict.objectId : undefined,
      typeof conflict.conflictId === 'string' ? conflict.conflictId : crypto.randomUUID(),
    )
  }
  await recoverUncoveredTombstonedPortableFiles(
    binding,
    new Set(objects.map(object => object.objectId)),
  )
  await cleanupDeletedFolders(binding)
  await (await getDb()).execute(
    `update self_hosted_inbox set state = 'applied', applied_at = $1, error_code = null
     where workspace_id = $2 and state in ('pending', 'failed')
       and cast(sequence as integer) <= cast($3 as integer)`,
    [Date.now(), binding.workspaceId, snapshotSequence]
  )
  // No pull runs concurrently with bootstrap. Rows beyond the authoritative
  // snapshot can only belong to the superseded cursor branch (for example
  // after a server restore), so they must not replay over the new snapshot.
  await (await getDb()).execute(
    `delete from self_hosted_inbox
     where workspace_id = $1 and cast(sequence as integer) > cast($2 as integer)`,
    [binding.workspaceId, snapshotSequence],
  )
  await client.acknowledge(binding.workspaceId, snapshotSequence, session.syncEpoch)
  await updatePulledCursor(binding.workspaceId, snapshotSequence)
  await updateCursor(binding.workspaceId, snapshotSequence, snapshotSequence)
  await updateBindingSession(
    binding.workspaceId,
    session.syncEpoch,
    session.workspace.capabilities.includes('content.update'),
  )
}

async function recordBootstrapApplyFailure(
  workspaceId: string,
  objectId: string,
  kind: SyncObjectKind,
  error: unknown,
) {
  const database = await getDb()
  const detail = JSON.stringify({
    kind,
    error: String(error instanceof Error ? error.message : error).slice(0, 500),
  })
  const existing = await database.select<Array<{ id: string }>>(
    `select id from self_hosted_conflicts
     where workspace_id = $1 and object_id = $2
       and conflict_type = 'bootstrap-apply-failed' and state = 'unresolved'
     limit 1`,
    [workspaceId, objectId],
  )
  if (existing[0]) {
    await database.execute(
      `update self_hosted_conflicts set remote_snapshot = $1
       where id = $2`,
      [detail, existing[0].id],
    )
    return
  }
  await database.execute(
    `insert into self_hosted_conflicts(
       id, workspace_id, object_id, conflict_type, remote_snapshot, state, created_at
     ) values ($1, $2, $3, 'bootstrap-apply-failed', $4, 'unresolved', $5)`,
    [crypto.randomUUID(), workspaceId, objectId, detail, Date.now()],
  )
}

async function writeJournaled(binding: Binding, objectId: string, relativePath: string, content: string) {
  await invoke('self_hosted_atomic_write', {
    workspaceId: binding.workspaceId,
    objectId,
    workspaceRoot: binding.localRoot,
    relativePath,
    contents: encodeUtf8Base64Url(content),
    expectedHash: await invoke<string>('self_hosted_sha256', { value: content }),
  })
}

interface RemoteEditorSnapshotPlan {
  content: string
  merged: boolean
  conflict: {
    localSnapshot: string
    baseSnapshot: string | null
    localCopyPath: string
  } | null
}

async function rollbackRemoteEditorSnapshot(
  binding: Binding,
  objectId: string,
  relativePath: string,
  previousContent: string | null,
  writtenContent: string,
) {
  const absolutePath = await join(binding.localRoot!, relativePath)
  const currentExists = await exists(absolutePath)
  const currentContent = currentExists ? await readTextFile(absolutePath) : null
  if (previousContent !== null) {
    if (currentContent === previousContent) return
    if (currentContent !== null && currentContent !== writtenContent) {
      throw new Error('remote_file_rollback_diverged')
    }
    await writeJournaled(binding, objectId, relativePath, previousContent)
    return
  }
  if (currentContent === null) return
  if (currentContent !== writtenContent) {
    throw new Error('remote_file_rollback_diverged')
  }
  await invoke<boolean>('self_hosted_delete_file', {
    workspaceId: binding.workspaceId,
    objectId,
    workspaceRoot: binding.localRoot,
    relativePath,
    expectedHash: await invoke<string>('self_hosted_sha256', { value: writtenContent }),
  })
}

async function writeRemoteEditorSnapshot(
  binding: Binding,
  objectId: string,
  relativePath: string,
  resolveSnapshot: (currentContent: string | null) => Promise<RemoteEditorSnapshotPlan>,
): Promise<RemoteEditorSnapshotPlan> {
  // Importing the store installs the path transaction runner even when the
  // first remote snapshot arrives before the editor route has mounted.
  const { default: useArticleStore } = await import('@/stores/article')
  const activePath = useArticleStore.getState().activeFilePath
  if (editorPathsReferToSameFile(activePath, relativePath) && !prepareActiveEditorDeactivation()) {
    throw new Error('remote_file_editor_busy')
  }
  const initialMutationRevision = getEditorPathMutationRevision(relativePath)
  let appliedSnapshot: RemoteEditorSnapshotPlan | null = null
  const accepted = await runEditorPathWriteTransaction(
    relativePath,
    async ({ hasQueuedSave }) => {
      if (getEditorPathMutationRevision(relativePath) !== initialMutationRevision) return false
      const absolutePath = await join(binding.localRoot!, relativePath)
      const existed = await exists(absolutePath)
      const previousContent = existed ? await readTextFile(absolutePath) : null
      if (hasQueuedSave()) return false

      const snapshot = await resolveSnapshot(previousContent)
      if (
        hasQueuedSave()
        || getEditorPathMutationRevision(relativePath) !== initialMutationRevision
      ) {
        return false
      }

      try {
        if (snapshot.conflict) {
          await writeJournaled(
            binding,
            objectId,
            snapshot.conflict.localCopyPath,
            snapshot.conflict.localSnapshot,
          )
        }
        await writeJournaled(binding, objectId, relativePath, snapshot.content)
      } catch (error) {
        await rollbackRemoteEditorSnapshot(
          binding,
          objectId,
          relativePath,
          previousContent,
          snapshot.content,
        )
        throw error
      }

      const targetIsActive = editorPathsReferToSameFile(
        useArticleStore.getState().activeFilePath,
        relativePath,
      )
      const editorIsStable = !targetIsActive || prepareActiveEditorDeactivation()
      if (
        !editorIsStable
        || hasQueuedSave()
        || getEditorPathMutationRevision(relativePath) !== initialMutationRevision
      ) {
        await rollbackRemoteEditorSnapshot(
          binding,
          objectId,
          relativePath,
          previousContent,
          snapshot.content,
        )
        return false
      }

      markEditorPathMutation(relativePath)
      if (targetIsActive) useArticleStore.getState().setCurrentArticle(snapshot.content)
      // Keep the accepted editor snapshot adjacent to the serialized write.
      // The listeners update TipTap, the desktop tab cache, and mobile's
      // contentRef without scheduling a stale save back to disk.
      emitter.emit('sync-content-updated', { path: relativePath, content: snapshot.content })
      appliedSnapshot = snapshot
      return true
    },
  )
  if (!accepted) throw new Error('remote_file_local_activity')
  if (!appliedSnapshot) throw new Error('remote_file_snapshot_missing')
  return appliedSnapshot
}

async function deleteRemoteEditorFile(
  binding: Binding,
  objectId: string,
  relativePath: string,
  expectedHash: string | null,
) {
  const localRoot = binding.localRoot
  if (!localRoot) throw new Error('remote_delete_workspace_root_missing')

  const { default: useArticleStore } = await import('@/stores/article')
  const activePath = useArticleStore.getState().activeFilePath
  if (editorPathsReferToSameFile(activePath, relativePath) && !prepareActiveEditorDeactivation()) {
    throw new Error('remote_delete_editor_busy')
  }
  const initialMutationRevision = getEditorPathMutationRevision(relativePath)
  const accepted = await runEditorPathWriteTransaction(
    relativePath,
    async ({ hasQueuedSave }) => {
      if (getEditorPathMutationRevision(relativePath) !== initialMutationRevision) return false
      const absolutePath = await join(localRoot, relativePath)
      const fileExists = await exists(absolutePath)
      const previousContent = fileExists ? await readTextFile(absolutePath) : null
      if (hasQueuedSave()) return false

      if (fileExists && expectedHash) {
        const deleted = await invoke<boolean>('self_hosted_delete_file', {
          workspaceId: binding.workspaceId,
          objectId,
          workspaceRoot: binding.localRoot,
          relativePath,
          expectedHash,
        })
        if (!deleted && await exists(absolutePath)) return false
      }

      const targetIsActive = editorPathsReferToSameFile(
        useArticleStore.getState().activeFilePath,
        relativePath,
      )
      const editorIsStable = !targetIsActive || prepareActiveEditorDeactivation()
      if (
        !editorIsStable
        || hasQueuedSave()
        || getEditorPathMutationRevision(relativePath) !== initialMutationRevision
      ) {
        if (previousContent !== null) {
          await writeJournaled(binding, objectId, relativePath, previousContent)
        }
        return false
      }

      try {
        await useArticleStore.getState().cleanTabsByDeletedFile(relativePath, localRoot)
      } catch (error) {
        await rollbackRemoteEditorSnapshot(
          binding,
          objectId,
          relativePath,
          previousContent,
          '',
        )
        throw error
      }
      if (
        hasQueuedSave()
        || getEditorPathMutationRevision(relativePath) !== initialMutationRevision
      ) {
        await rollbackRemoteEditorSnapshot(
          binding,
          objectId,
          relativePath,
          previousContent,
          '',
        )
        return false
      }

      markEditorPathMutation(relativePath)
      emitter.emit('editor-file-close', { path: relativePath })
      return true
    },
  )
  if (!accepted) throw new Error('remote_delete_local_activity')
}

async function writeBytesJournaled(binding: Binding, objectId: string, relativePath: string, content: Uint8Array) {
  await invoke('self_hosted_atomic_write', {
    workspaceId: binding.workspaceId,
    objectId,
    workspaceRoot: binding.localRoot,
    relativePath,
    contents: bytesToBase64Url(content),
    expectedHash: await hashBytes(content),
  })
}

async function recordEventRevision(workspaceId: string, event: SyncEvent) {
  if (!event.objectId || typeof event.metadata.revision !== 'string') return
  await recordRevision(workspaceId, event.objectId, event.metadata.revision, event.sequence, event.ciphertextHash ?? '')
}

async function recordAppliedCommandRevision(
  binding: Binding,
  command: {
    type?: string
    objectId?: string
    kind?: SyncObjectKind
    keyVersion?: number
    ciphertext?: string
    ciphertextHash?: string
    blobRefs?: string[]
  },
  revision: string,
  sequence: string,
) {
  if (!command.objectId) return
  let appliedContentHash = command.ciphertextHash ?? ''
  if (
    command.type === 'upsert-object'
    && (command.kind === 'note' || command.kind === 'asset')
    && command.ciphertext
    && command.keyVersion
  ) {
    try {
      const key = await loadWorkspaceKey(binding.workspaceId, command.keyVersion)
      const payload = await decryptPackedJson<Record<string, unknown>>(
        key,
        command.ciphertext,
        objectAssociatedData(binding.workspaceId, command.objectId, command.kind),
      )
      if (typeof payload.plaintextHash === 'string') {
        appliedContentHash = payload.plaintextHash
      }
      if (payload.domain === 'file' && typeof payload.content === 'string') {
        const hash = await invoke<string>('self_hosted_sha256', { value: payload.content })
        appliedContentHash = hash
        await (await getDb()).execute(
          `update self_hosted_object_mappings
           set content_hash = $1, blob_refs = $2, updated_at = $3
           where workspace_id = $4 and object_id = $5`,
          [
            hash,
            JSON.stringify(command.blobRefs ?? []),
            Date.now(),
            binding.workspaceId,
            command.objectId,
          ],
        )
        await (await getDb()).execute(
          `insert or replace into self_hosted_revisions(
             workspace_id, object_id, revision, sequence, content_hash, snapshot, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            binding.workspaceId,
            command.objectId,
            revision,
            sequence,
            hash,
            payload.content,
            Date.now(),
          ],
        )
        return
      }
      if (appliedContentHash) {
        await (await getDb()).execute(
          `update self_hosted_object_mappings
           set content_hash = $1, blob_refs = $2, updated_at = $3
           where workspace_id = $4 and object_id = $5`,
          [
            appliedContentHash,
            JSON.stringify(command.blobRefs ?? []),
            Date.now(),
            binding.workspaceId,
            command.objectId,
          ],
        )
      }
    } catch (error) {
      console.warn('[self-hosted-sync] Unable to retain local revision snapshot', {
        workspaceId: binding.workspaceId,
        objectId: command.objectId,
        error,
      })
    }
  }
  await recordRevision(
    binding.workspaceId,
    command.objectId,
    revision,
    sequence,
    appliedContentHash,
  )
}

async function recordRevision(workspaceId: string, objectId: string, revision: string, sequence: string, hash: string) {
  const database = await getDb()
  await database.execute(
    `insert or ignore into self_hosted_revisions(
       workspace_id, object_id, revision, sequence, content_hash, created_at
     ) values ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, objectId, revision, sequence, hash, Date.now()]
  )
}

async function recordProtocolConflict(workspaceId: string, objectId: string | undefined, conflictId: string) {
  const database = await getDb()
  await database.execute(
    `insert or ignore into self_hosted_conflicts(
       id, workspace_id, object_id, conflict_type, state, created_at
     ) values ($1, $2, $3, 'protocol-conflict', 'unresolved', $4)`,
    [conflictId, workspaceId, objectId ?? null, Date.now()]
  )
}

async function updateBindingSession(workspaceId: string, syncEpoch: string, writable: boolean) {
  const database = await getDb()
  await database.execute(
    `update self_hosted_workspace_bindings set sync_epoch = $1, binding_state = 'bound',
       access_mode = $2, updated_at = $3 where workspace_id = $4`,
    [syncEpoch, writable ? 'read-write' : 'read-only', Date.now(), workspaceId]
  )
}

async function setBindingState(workspaceId: string, state: string) {
  const database = await getDb()
  await database.execute(
    'update self_hosted_workspace_bindings set binding_state = $1, updated_at = $2 where workspace_id = $3',
    [state, Date.now(), workspaceId]
  )
}

async function revokeBindingAccess(workspaceId: string) {
  const database = await getDb()
  const keys = await database.select<Array<{ secureStorageKey: string }>>(
    `select secure_storage_key as secureStorageKey from self_hosted_workspace_keys
     where workspace_id = $1`,
    [workspaceId]
  )
  await Promise.all(keys.map(key => secureDelete(key.secureStorageKey)))
  await database.execute('delete from self_hosted_workspace_keys where workspace_id = $1', [workspaceId])
  await database.execute(
    `update self_hosted_workspace_bindings
     set binding_state = 'access-revoked', access_mode = 'read-only', updated_at = $1
     where workspace_id = $2`,
    [Date.now(), workspaceId]
  )
}

async function updatePulledCursor(workspaceId: string, pulled: string) {
  const database = await getDb()
  await database.execute(
    `insert into self_hosted_cursors(workspace_id, pulled_sequence, updated_at)
     values ($1, $2, $3)
     on conflict(workspace_id) do update set pulled_sequence = excluded.pulled_sequence, updated_at = excluded.updated_at`,
    [workspaceId, pulled, Date.now()]
  )
}

async function updateAppliedCursor(workspaceId: string, applied: string) {
  const database = await getDb()
  await database.execute(
    `insert into self_hosted_cursors(workspace_id, applied_sequence, updated_at)
     values ($1, $2, $3)
     on conflict(workspace_id) do update set applied_sequence = excluded.applied_sequence, updated_at = excluded.updated_at`,
    [workspaceId, applied, Date.now()]
  )
}

async function updateCursor(workspaceId: string, applied: string, acknowledged: string) {
  const database = await getDb()
  await database.execute(
    `insert into self_hosted_cursors(workspace_id, applied_sequence, acknowledged_sequence, updated_at)
     values ($1, $2, $3, $4)
     on conflict(workspace_id) do update set
       applied_sequence = excluded.applied_sequence,
       acknowledged_sequence = excluded.acknowledged_sequence,
       updated_at = excluded.updated_at`,
    [workspaceId, applied, acknowledged, Date.now()]
  )
}

function retryDelay(attempt: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6))
}

function conflictCopyPath(relativePath: string) {
  const dot = relativePath.lastIndexOf('.')
  const suffix = `.conflict-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`
  return dot > relativePath.lastIndexOf('/')
    ? `${relativePath.slice(0, dot)}${suffix}${relativePath.slice(dot)}`
    : `${relativePath}${suffix}`
}

function mergeTextSnapshots(base: string, local: string, remote: string) {
  if (local === base) return remote
  if (remote === base || local === remote) return local
  const baseLines = base.split('\n')
  const localLines = local.split('\n')
  const remoteLines = remote.split('\n')
  if (baseLines.length !== localLines.length || baseLines.length !== remoteLines.length) return null
  const merged = [...baseLines]
  for (let index = 0; index < baseLines.length; index++) {
    const localChanged = localLines[index] !== baseLines[index]
    const remoteChanged = remoteLines[index] !== baseLines[index]
    if (localChanged && remoteChanged && localLines[index] !== remoteLines[index]) return null
    if (localChanged) merged[index] = localLines[index]
    else if (remoteChanged) merged[index] = remoteLines[index]
  }
  return merged.join('\n')
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __noteGenSelfHostedSyncRuntime?: SelfHostedSyncRuntime
}

export function getSelfHostedSyncRuntime() {
  runtimeGlobal.__noteGenSelfHostedSyncRuntime ??= new SelfHostedSyncRuntime()
  return runtimeGlobal.__noteGenSelfHostedSyncRuntime
}
