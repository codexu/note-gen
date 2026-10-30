import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, exists, mkdir, readFile, readTextFile, writeFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { Store } from '@tauri-apps/plugin-store'
import { executeRecordTransaction, getDb } from '@/db'
import { SelfHostedApiError } from './client'
import {
  authenticatedClient, isSelfHostedAuthenticationError, isSelfHostedSecureStorageError, reconcilePersonalWorkspaceObjects,
  markProfileReauthenticationRequired, secureDelete, getProfile,
} from './profile'
import { decryptPackedJson, encodeUtf8Base64Url, loadWorkspaceKey, objectAssociatedData } from './crypto'
import {
  enqueueAssetSnapshot,
  enqueueFileSnapshot,
  enqueueFolderSnapshot,
  materializeOutbox,
} from './outbox'
import { applyStructuredPayload, deleteStructuredObject } from './structured'
import { enabledPersonalSyncKinds, isPersonalSyncKindEnabled } from './domains'
import { hydratePersonalAssets } from './personal-assets'
import { hasPendingPersonalMutation, pendingPersonalChangesForEvent } from './pending-personal'
import { recoverPersonalRevisionConflicts } from './personal-recovery'
import { discoverLibraryWorkspaces, ensureManagedWorkspaceKeys, getCurrentWorkspaceRoot, reconcileLibraryFiles } from './workspaces'
import { bytesToBase64Url, downloadAsset, hashBytes } from './blob'
import type { SyncBootstrapPage, SyncEvent, SyncObjectKind, SyncSession } from './protocol'
import { applyConversationTombstones, type SelfHostedSnapshotObject } from './snapshot'
import emitter from '@/lib/emitter'
import useSyncStore from '@/stores/sync'
import { withSelfHostedPrepareLock } from './prepare-lock'
import { ensureWorkspaceDirectory } from '@/lib/managed-workspace'
import type { SwitchOperationProgress } from '@/lib/sync/platform-switch-plan'
import {
  editorPathsReferToSameFile,
  getEditorPathMutationRevision,
  markEditorPathMutation,
  prepareActiveEditorDeactivation,
  prepareActiveEditorPathMutationDurably,
  runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'

class PendingPathMove extends Error {
  constructor() { super('remote_path_move_pending') }
}

class PendingLocalChange extends Error {
  constructor() { super('SELF_HOSTED_LOCAL_CHANGES_PENDING') }
}

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
  restoreLocalSnapshot: number
}

type SyncItemProgress = Pick<SwitchOperationProgress, 'current' | 'total' | 'path'>

export class SelfHostedSyncRuntime {
  #manualRetryRequested = false
  #running = false
  #rerun = false
  #stopped = true
  #secureStoragePaused = false
  #wakeCompletion: Promise<void> | null = null
  #socket: WebSocket | null = null
  #socketWorkspaceSignature = ''
  #socketGeneration = 0
  #socketRetryTimer: ReturnType<typeof setTimeout> | null = null
  #socketRetryDelay = 1_000
  #timer: ReturnType<typeof setTimeout> | null = null
  #realtimeListeners = new Set<(message: Record<string, unknown>) => void>()
  #documentSubscriptions = new Map<string, number>()
  #presence: Record<string, unknown> | null = null
  #presenceOwner: symbol | null = null
  #progressListeners = new Set<(progress: SwitchOperationProgress) => void>()
  #conflictResolution: Promise<void> | null = null
  #lastLibraryDiscoveryAt = 0

  async withConflictResolution<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#conflictResolution
    let release: () => void = () => {}
    const pending = new Promise<void>(resolve => { release = resolve })
    this.#conflictResolution = pending
    try {
      await previous
      await this.#wakeCompletion
      return await operation()
    } finally {
      release()
      if (this.#conflictResolution === pending) {
        this.#conflictResolution = null
        if (!this.#stopped) void this.wake('conflict-resolved')
      }
    }
  }

  start(reason: 'startup' | 'manual-retry' = 'startup') {
    if (this.#secureStoragePaused) return
    this.#stopped = false
    void this.wake(reason)
  }

  allowSecureStorageRetry() {
    this.#secureStoragePaused = false
  }

  waitForCurrentRun(): Promise<void> {
    return this.#wakeCompletion ?? Promise.resolve()
  }

  subscribeProgress(listener: (progress: SwitchOperationProgress) => void) {
    this.#progressListeners.add(listener)
    return () => { this.#progressListeners.delete(listener) }
  }

  #reportProgress(progress: Omit<SwitchOperationProgress, 'phase' | 'kind'>) {
    for (const listener of this.#progressListeners) listener({ phase: 'start', kind: 'item', ...progress })
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
    this.#lastLibraryDiscoveryAt = 0
    this.#socketGeneration++
    if (this.#socketRetryTimer) clearTimeout(this.#socketRetryTimer)
    this.#socketRetryTimer = null
    this.#socket?.close()
    this.#socket = null
    this.#socketWorkspaceSignature = ''
    this.#presence = null
    this.#presenceOwner = null
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }

  #pauseForSecureStorage() {
    this.#secureStoragePaused = true
    this.stop()
  }

  async stopAndWait() {
    this.stop()
    await this.#wakeCompletion
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
    if (this.#secureStoragePaused) return Promise.resolve()
    if (reason === 'manual-retry') this.#manualRetryRequested = true
    // A collaborative drain can request a wake while the editor resolver is
    // waiting for that drain. Defer sending without making it await itself.
    if (this.#conflictResolution) return Promise.resolve()
    if (this.#stopped) return Promise.resolve()
    if (reason === 'foreground' || reason === 'network') {
      // iOS may suspend a socket without changing its JS OPEN state.
      // Rejoin the rooms and catch up over HTTP instead of trusting it.
      this.#socketGeneration++
      const socket = this.#socket
      this.#socket = null
      this.#socketWorkspaceSignature = ''
      socket?.close()
    }
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
    const errors = new Set<string>()
    try {
      const discoveryErrors = new Set<string>()
      await this.#discoverLibraries(reason, discoveryErrors)
      do {
        this.#rerun = false
        // A rerun visits every binding again. Report its final outcome instead
        // of retaining failures that an earlier pass has already recovered.
        errors.clear()
        for (const error of discoveryErrors) errors.add(error)
        const manualRetry = this.#manualRetryRequested
        this.#manualRetryRequested = false
        const bindings = await listBindings()
        const sessions: Array<{ profileId: string; session: SyncSession }> = []
        for (const binding of bindings) {
          if (this.#stopped) break
          try {
            if (manualRetry) {
              const database = await getDb()
              const acknowledged = await releaseAcknowledgedRevisionConflicts(binding)
              if (acknowledged && binding.workspaceType === 'library') {
                // Refresh the accepted base before scanning the kept local
                // file again, otherwise its old bytes would create the same
                // rejected command on every retry.
                binding.bindingState = 'epoch-changed'
                await setBindingState(binding.workspaceId, 'epoch-changed')
              }
              await database.execute(
                "update self_hosted_outbox set next_attempt_at = 0 where workspace_id = $1 and state = 'retry'",
                [binding.workspaceId],
              )
              await database.execute(
                `update self_hosted_local_changes set next_attempt_at = 0
                 where state = 'pending' and (workspace_id = $1 or (workspace_id is null and $2 = 'account-data'))`,
                [binding.workspaceId, binding.workspaceType],
              )
            }
            const session = await this.#syncBinding(binding, errors)
            if (session) sessions.push({ profileId: binding.profileId, session })
          } catch (error) {
            if (error instanceof SelfHostedApiError && (error.status === 0 || error.status >= 500)) {
              useSyncStore.getState().setSelfHostedServiceAvailable(false)
            }
            if (isSelfHostedAuthenticationError(error) || isSelfHostedSecureStorageError(error)) throw error
            errors.add(error instanceof Error ? error.message : String(error))
            console.warn('[self-hosted-sync] Workspace synchronization failed', {
              reason,
              workspaceId: binding.workspaceId,
              workspaceType: binding.workspaceType,
              error,
            })
          }
        }
        if (!this.#stopped && sessions.length > 0) this.#connectSocket(sessions[0].profileId, sessions.map(item => item.session))
      } while (this.#rerun && !this.#stopped)
    } catch (error) {
      errors.add(error instanceof Error ? error.message : String(error))
      if (isSelfHostedSecureStorageError(error)) {
        this.#pauseForSecureStorage()
      } else if (isSelfHostedAuthenticationError(error)) {
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
      emitter.emit('sync-engine-completed', { provider: 'selfHosted', errors: [...errors] })
      this.#running = false
      this.#wakeCompletion = null
      if (!this.#stopped) {
        this.#timer = setTimeout(() => void this.wake('network'), 30_000)
      }
    }
  }

  async #discoverLibraries(reason: string, errors: Set<string>) {
    const force = ['startup', 'foreground', 'network', 'manual-retry'].includes(reason)
    if (this.#stopped || (!force && Date.now() - this.#lastLibraryDiscoveryAt < 30_000)) return
    this.#lastLibraryDiscoveryAt = Date.now()
    const profiles = await (await getDb()).select<Array<{ id: string }>>(
      "select id from self_hosted_sync_profiles where state = 'connected'",
    )
    const reportError = (profileId: string, workspaceId: string | null, error: unknown) => {
      if (isSelfHostedAuthenticationError(error) || isSelfHostedSecureStorageError(error)) throw error
      errors.add(error instanceof Error ? error.message : String(error))
      console.warn('[self-hosted-sync] Workspace discovery failed', { profileId, workspaceId, error })
    }
    for (const profile of profiles) {
      if (this.#stopped) return
      try {
        const discovered = await discoverLibraryWorkspaces(profile.id, () => !this.#stopped,
          (workspaceId, error) => reportError(profile.id, workspaceId, error))
        if (discovered > 0) emitter.emit('self-hosted-workspaces-discovered', { profileId: profile.id })
      } catch (error) {
        reportError(profile.id, null, error)
      }
    }
  }

  async #syncBinding(binding: Binding, errors: Set<string>) {
    if (binding.workspaceType === 'library' && binding.localRoot) {
      await ensureWorkspaceDirectory(binding.localRoot)
    }
    const report = (
      startupTask: NonNullable<SwitchOperationProgress['startupTask']>,
      value: Partial<Omit<SwitchOperationProgress, 'phase' | 'kind' | 'startupTask'>> = {},
    ) => this.#reportProgress({ startupTask, source: 'remote', path: binding.localRoot ?? undefined, current: 0, total: 0, ...value })
    report('connect')
    if (binding.workspaceType !== 'account-data') await assertNoUnresolvedRevisionCommands(binding.workspaceId)
    const { profile, client } = await authenticatedClient(binding.profileId)
    if (this.#stopped) return null
    let session: SyncSession
    try {
      session = await client.syncSession(
        binding.workspaceId,
        binding.appliedSequence,
        binding.bindingState === 'epoch-changed' ? undefined : binding.syncEpoch ?? undefined,
      )
    } catch (error) {
      if (!(error instanceof SelfHostedApiError)
        || error.body.code === 'invalid_response'
        || (error.body.code !== 'request_cancelled' && (error.status === 0 || error.status >= 500))) {
        useSyncStore.getState().setSelfHostedServiceAvailable(false)
      }
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
    if (this.#stopped) return null
    if (!session.protocol.compatible) {
      useSyncStore.getState().setSelfHostedServiceAvailable(false)
      await setBindingState(binding.workspaceId, 'protocol-incompatible')
      return null
    }
    useSyncStore.getState().setSelfHostedServiceAvailable(true)
    await ensureManagedWorkspaceKeys(
      binding.profileId,
      binding.workspaceId,
      session.keyVersions.map(key => key.keyVersion),
    )
    if (this.#stopped) return null
    if (await recoverPersonalRevisionConflicts(binding, session, errors)) this.#rerun = true
    const pushAvailableOutbox = async (pathMovesOnly = false) => {
      try {
        return await pushOutbox(binding, session, pathMovesOnly, errors)
      } catch (error) {
        if (binding.workspaceType !== 'account-data' || !(error instanceof Error)
          || error.message !== 'SELF_HOSTED_REVISION_CONFLICT') throw error
        // Recover the existing queue as well as a rejection from this round.
        // Retrying uses a fresh command id and a fresh server CAS base.
        if (await recoverPersonalRevisionConflicts(binding, session, errors)) this.#rerun = true
        return false
      }
    }
    if (
      session.bootstrap.required
      || binding.bindingState !== 'bound'
      || await hasCoveredFailedInbox(binding)
      || await hasIncompleteBootstrap(binding)
      || await hasAmbiguousTombstonedLibraryFile(binding)
    ) {
      // A pending rename owns its local paths until its frozen commands reach
      // the server. Do not enter bootstrap and replay the old paths meanwhile.
      if ((await pendingPathMovesForBinding(binding)).length > 0) {
        report('push')
        if (await pushAvailableOutbox(true)) this.#rerun = true
        return session
      }
      if (binding.workspaceType === 'account-data') {
        // A bootstrap must not replace a row while its local edit or delete
        // is still waiting to be accepted. Send frozen commands first, then
        // capture subsequent edits against the accepted base.
        report('push')
        if (await pushAvailableOutbox()) this.#rerun = true
        if (this.#stopped) return null
        let hasMore: boolean
        do {
          report('prepare', { source: 'local' })
          const prepared = await materializeOutbox(
            binding.workspaceId, binding.workspaceType, binding.localRoot,
            session.limits.maxCommandsPerBatch, binding.profileId, session.syncEpoch,
            Math.max(1, ...session.keyVersions.map(key => key.keyVersion)), session.limits.maxObjectBytes,
          )
          for (const error of prepared.errors) errors.add(error)
          hasMore = prepared.hasMore
          if (this.#stopped) return null
          report('push')
          if (await pushAvailableOutbox()) this.#rerun = true
          if (this.#stopped) return null
        } while (hasMore)
      }
      await setBindingState(binding.workspaceId, 'bootstrapping')
      report('bootstrap')
      await bootstrapBinding(binding, session, errors, value => report('bootstrap', value))
      report('refresh', { source: 'local' })
      await refreshBindingStores(binding)
      if (this.#stopped) return null
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
    if (this.#stopped) return null
    if (binding.workspaceType === 'library' && binding.localRoot) {
      report('scanFiles', { source: 'local' })
      await reconcileLibraryFiles(
        binding.workspaceId,
        binding.localRoot,
        session.workspace.capabilities.includes('content.update'),
        value => report('scanFiles', { source: 'local', ...value }),
      )
    }
    if (this.#stopped) return null
    if (binding.workspaceType === 'account-data') {
      report('scanData', { source: 'local' })
      await reconcilePersonalWorkspaceObjects(binding.workspaceId)
    }
    if (this.#stopped) return null
    report('prepare', { source: 'local' })
    const preparation = await materializeOutbox(
      binding.workspaceId,
      binding.workspaceType,
      binding.localRoot,
      session.limits.maxCommandsPerBatch,
      binding.profileId,
      session.syncEpoch,
      Math.max(1, ...session.keyVersions.map(key => key.keyVersion)),
      session.limits.maxObjectBytes,
    )
    for (const error of preparation.errors) errors.add(error)
    if (preparation.hasMore) this.#rerun = true
    if (this.#stopped) return null
    report('push')
    if (await pushAvailableOutbox()) this.#rerun = true
    if (this.#stopped) return null
    report('pull')
    await pullEvents(binding, session, value => report('pull', value))
    if (this.#stopped) return null
    report('apply')
    const application = await applyInbox(
      binding,
      profile.deviceId,
      objectId => this.#documentSubscriptions.has(`${binding.workspaceId}\0${objectId}`),
      value => report('apply', value),
      () => report('refresh', { source: 'local' }),
    )
    const appliedThrough = application.through
    if (this.#stopped) return null
    for (const listener of this.#realtimeListeners) listener({
      type: 'inbox.applied', workspaceId: binding.workspaceId,
    })
    // Applying the inbox advances the local cursor before the HTTP ACK.
    // Compare with the server's acknowledged cursor so a failed ACK is
    // retried even when this run has no new events to apply.
    if (BigInt(appliedThrough) > BigInt(session.cursor.acknowledged)) {
      await client.acknowledge(binding.workspaceId, appliedThrough, session.syncEpoch)
      await updateCursor(binding.workspaceId, appliedThrough, appliedThrough)
    } else {
      // The server may have accepted the previous ACK before its response
      // was lost. Reconcile that result without claiming unapplied events.
      const acknowledged = BigInt(session.cursor.acknowledged) > BigInt(appliedThrough)
        ? appliedThrough : session.cursor.acknowledged
      await updateCursor(binding.workspaceId, appliedThrough, acknowledged)
    }
    if (application.error) throw application.error
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
    const generation = ++this.#socketGeneration
    const previousSocket = this.#socket
    this.#socket = null
    previousSocket?.close()
    this.#socketWorkspaceSignature = workspaceSignature
    void authenticatedClient(profileId).then(async ({ accessToken }) => {
      if (this.#stopped || generation !== this.#socketGeneration || this.#socketWorkspaceSignature !== workspaceSignature) return
      const socket = new WebSocket(first.websocketUrl)
      this.#socket = socket
      const authTimeout = setTimeout(() => {
        if (this.#socket === socket) socket.close()
      }, 10_000)
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
          type: 'authenticate',
          accessToken,
          workspaceIds: sessions.map(session => session.workspace.id),
          expectedSyncEpoch: first.syncEpoch,
        }))
      })
      socket.addEventListener('message', event => {
        if (this.#socket !== socket) return
        const message = JSON.parse(String(event.data)) as { type?: string; workspaceId?: string }
        for (const listener of this.#realtimeListeners) listener(message)
        if (message.type === 'authenticated') {
          clearTimeout(authTimeout)
          this.#socketRetryDelay = 1_000
          if (this.#socketRetryTimer) clearTimeout(this.#socketRetryTimer)
          this.#socketRetryTimer = null
          for (const subscription of this.#documentSubscriptions.keys()) {
            const [workspaceId, documentId] = subscription.split('\0')
            socket.send(JSON.stringify({ type: 'document.subscribe', workspaceId, documentId }))
          }
          if (this.#presence) socket.send(JSON.stringify(this.#presence))
          // Recover notifications sent between the HTTP pull and joining
          // the realtime rooms, including deletes received while offline.
          void this.wake('realtime-authenticated')
        } else if (message.type === 'workspace.metadata-changed') {
          this.#lastLibraryDiscoveryAt = 0
          emitter.emit('self-hosted-workspaces-discovered', { profileId })
          void this.wake('websocket')
        } else if (message.type === 'workspace.changed' || message.type === 'workspace.members-changed') {
          void this.wake('websocket')
        } else if (message.type === 'workspace.access-revoked' && message.workspaceId) {
          void revokeBindingAccess(message.workspaceId)
        }
      })
      socket.addEventListener('close', () => {
        clearTimeout(authTimeout)
        if (this.#socket === socket) {
          this.#socket = null
          this.#socketWorkspaceSignature = ''
          this.#scheduleSocketReconnect()
        }
      })
    }).catch(error => {
      if (generation !== this.#socketGeneration || this.#stopped) return
      if (isSelfHostedSecureStorageError(error)) {
        this.#pauseForSecureStorage()
        emitter.emit('sync-engine-completed', {
          provider: 'selfHosted', errors: [error instanceof Error ? error.message : String(error)],
        })
        return
      }
      if (!isSelfHostedAuthenticationError(error)) {
        console.warn('[self-hosted-sync] Unable to connect realtime channel', error)
        this.#scheduleSocketReconnect()
      }
    })
  }

  #scheduleSocketReconnect() {
    if (this.#stopped || this.#socketRetryTimer) return
    this.#socketRetryTimer = setTimeout(() => {
      this.#socketRetryTimer = null
      void this.wake('realtime-reconnect')
    }, this.#socketRetryDelay)
    this.#socketRetryDelay = Math.min(this.#socketRetryDelay * 2, 15_000)
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

async function hasIncompleteBootstrap(binding: Binding) {
  const rows = await (await getDb()).select<Array<{ found: number }>>(
    `select 1 as found from self_hosted_conflicts
     where workspace_id = $1 and conflict_type = 'bootstrap-apply-failed'
       and state <> 'resolved' limit 1`,
    [binding.workspaceId],
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

async function pushOutbox(binding: Binding, session: SyncSession, pathMovesOnly = false, errors?: Set<string>) {
  const database = await getDb()
  const profile = binding.workspaceType === 'account-data' ? await getProfile(binding.profileId) : null
  if (binding.workspaceType === 'account-data' && !profile) throw new Error('自托管同步配置不存在')
  const domainToggles = profile?.domainToggles ?? {}
  // Filter before LIMIT so paused domains cannot occupy the whole batch.
  // Materialized payloads must obey the same dependency and deletion rules
  // as newly captured changes, including nested conflict resolutions.
  const rows = await database.select<OutboxRow[]>(
    `with candidates as (
       select o.*, o.rowid as outboxRowId, m.kind as mappingKind, m.relative_path as mappingPath,
         coalesce(json_extract(o.payload, '$.objectId'), json_extract(o.payload, '$.objectResolution.objectId'),
           json_extract(o.payload, '$.resolution.objectId'),
           (select object_id from self_hosted_conflicts where workspace_id = o.workspace_id
             and id = json_extract(o.payload, '$.conflictId') limit 1)) as effectiveObjectId,
         coalesce(json_extract(o.payload, '$.kind'), json_extract(o.payload, '$.objectResolution.kind'),
           json_extract(o.payload, '$.resolution.kind'), m.kind,
           (select parent.kind from self_hosted_conflicts conflict
            join self_hosted_object_mappings parent on parent.workspace_id = conflict.workspace_id and parent.object_id = conflict.object_id
            where conflict.workspace_id = o.workspace_id and conflict.id = json_extract(o.payload, '$.conflictId') limit 1)) as effectiveKind
       from self_hosted_outbox o
       left join self_hosted_object_mappings m
         on m.workspace_id = o.workspace_id
        and m.object_id = coalesce(json_extract(o.payload, '$.objectId'),
          json_extract(o.payload, '$.objectResolution.objectId'), json_extract(o.payload, '$.resolution.objectId'))
       where o.workspace_id = $1 and o.state in ('pending', 'retry') and o.next_attempt_at <= $2
         and ($4 = 0 or o.command_type = 'path-move')
     ), commandBlobRefs as (
       select c.command_id, refs.value as blobId from candidates c join json_each(c.payload, '$.blobRefs') refs
       union select c.command_id, refs.value from candidates c join json_each(c.payload, '$.objectResolution.blobRefs') refs
       union select c.command_id, refs.value from candidates c join json_each(c.payload, '$.resolution.blobRefs') refs
     )
     select command_id as commandId, source_change_ids as sourceChangeIds,
       payload, attempt_count as attemptCount, restore_local_snapshot as restoreLocalSnapshot
     from candidates o
     where ($5 = 'library' or (
       o.effectiveKind in (select value from json_each(
         case when json_extract(o.payload, '$.type') = 'delete-object'
           or json_extract(o.payload, '$.deleteObject') = 1 then $7 else $6 end))
       and ($8 = 1 or json_extract(o.payload, '$.type') = 'delete-object'
         or json_extract(o.payload, '$.deleteObject') = 1
         or not exists (
           select 1 from commandBlobRefs ref where ref.command_id = o.command_id
             and not exists (
               select 1 from self_hosted_remote_objects accepted join json_each(accepted.payload, '$.personalAssets') asset
               where accepted.workspace_id = o.workspace_id and accepted.object_id = o.effectiveObjectId
                 and json_extract(asset.value, '$.blobId') = ref.blobId
             )
         ))
     ))
     order by
       case when json_extract(o.payload, '$.type') = 'delete-object' and o.mappingKind = 'folder' then 2
            when o.mappingKind = 'folder' then 0 else 1 end,
       case when o.mappingKind = 'folder' and o.mappingPath is not null
         then (case when json_extract(o.payload, '$.type') = 'delete-object' then -1 else 1 end)
           * (length(o.mappingPath) - length(replace(o.mappingPath, '/', '')))
         else 0 end,
       o.created_at, o.outboxRowId limit $3`,
    [binding.workspaceId, Date.now(), session.limits.maxCommandsPerBatch, pathMovesOnly ? 1 : 0,
      binding.workspaceType, JSON.stringify(enabledPersonalSyncKinds(domainToggles)),
      JSON.stringify(enabledPersonalSyncKinds(domainToggles, true)), domainToggles.attachments === false ? 0 : 1]
  )
  if (rows.length === 0) return false
  let activatedCollaborativeObject = false
  let restoredPersonalSnapshot = false
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
  let revisionConflicted = false
  for (const result of response.results) {
    const row = rows.find(candidate => candidate.commandId === result.commandId)
    if (!row) continue
    if (result.code === 'revision_conflict' || (result.status === 'conflict' && !result.conflictId)) {
      const command = JSON.parse(row.payload) as { type?: string; kind?: string }
      const sourceIds = JSON.parse(row.sourceChangeIds) as number[]
      const covered = command.type === 'upsert-object' && command.kind === 'note' && sourceIds.length > 0
        ? await database.select<Array<{ id: number }>>(
          `select id from self_hosted_local_changes where workspace_id=$1 and state='queued'
           and reason='workspace:collaborative-snapshot' and id in (select value from json_each($2))`,
          [binding.workspaceId, JSON.stringify(sourceIds)],
        ) : []
      if (covered.length === sourceIds.length && sourceIds.length > 0) {
        // These exact snapshot bytes were already represented by durable Yjs
        // updates when frozen. A competing materialization is not an editing
        // conflict: retire only this snapshot, pull the new revision, and let
        // reconciliation publish the latest merged text against that base.
        const now = Date.now()
        await executeRecordTransaction([
          { sql: "update self_hosted_local_changes set state='superseded',updated_at=$1 where id in (select value from json_each($2))",
            values: [now, JSON.stringify(sourceIds)] },
          { sql: "update self_hosted_outbox set state='superseded',last_error_code='collaborative-snapshot-stale',updated_at=$1 where command_id=$2",
            values: [now, row.commandId] },
        ])
        activatedCollaborativeObject = true
        continue
      }
      // A CAS rejection has not accepted this payload and has no durable
      // server conflict object. Keep it locally and stop before pulling a
      // snapshot that could overwrite the only remaining local edit.
      await preserveRejectedRevision(binding, row, result.revision)
      revisionConflicted = true
      continue
    }
    if (result.status === 'applied' || result.status === 'conflict') {
      const command = JSON.parse(row.payload) as {
        type?: string; objectId?: string; documentId?: string; updateId?: string
        checkpointId?: string; keyVersion?: number; ciphertext?: string; coversDocumentSequence?: string
        ciphertextHash?: string; kind?: SyncObjectKind; blobRefs?: string[]
      }
      const stalePersonalAck = binding.workspaceType === 'account-data' && command.objectId && result.revision
        ? await personalAckHasNewerRevision(binding.workspaceId, command.objectId, result.revision) : false
      if (result.status === 'applied' && !stalePersonalAck && row.restoreLocalSnapshot === 1) {
        try {
          if (await restoreAcceptedPersonalSnapshot(binding, row, result.revision)) restoredPersonalSnapshot = true
        } catch (error) {
          if (isSelfHostedAuthenticationError(error)) throw error
          // The server already owns this command. Retain the frozen snapshot
          // and retry its local installation through the same idempotent ack,
          // while completing other acknowledgements and pulling remote events.
          const code = 'SELF_HOSTED_LOCAL_SNAPSHOT_RESTORE_PENDING'
          errors?.add(code)
          await database.execute(
            `update self_hosted_outbox set state = 'retry', attempt_count = attempt_count + 1,
               next_attempt_at = $1, last_error_code = $2, updated_at = $3 where command_id = $4`,
            [Date.now() + retryDelay(row.attemptCount), code, Date.now(), row.commandId],
          )
          console.warn('[self-hosted-sync] Accepted snapshot could not be restored locally', { workspaceId: binding.workspaceId, error })
          continue
        }
      }
      if (result.status === 'applied' && !stalePersonalAck && command.objectId && result.revision && result.sequence) {
        // Keep the accepted server base durable before releasing the frozen
        // command. A retry can recover this cache write from the same ack.
        await recordAppliedCommandRevision(binding, command, result.revision, result.sequence)
      } else if (result.status === 'applied' && !stalePersonalAck && binding.workspaceType === 'account-data'
        && row.restoreLocalSnapshot === 1 && command.type === 'delete-object' && command.objectId && result.revision) {
        // An already deleted object is acknowledged without an event sequence.
        // Retain its revision too, so older inbox snapshots cannot revive it.
        await recordRevision(binding.workspaceId, command.objectId, result.revision, binding.appliedSequence, command.ciphertextHash ?? '')
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
      if (!stalePersonalAck && command.objectId && result.revision && result.sequence) {
        if (result.status !== 'applied') {
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
             and json_extract(payload, '$.objectId') = $3
             and coalesce(last_error_code, '') != 'revision_conflict'`,
          [Date.now(), binding.workspaceId, command.objectId]
        )
        if (command.type === 'upsert-object') activatedCollaborativeObject = true
      }
      if (result.status === 'applied' && !stalePersonalAck && command.type === 'delete-object' && command.objectId) {
        await database.execute(
          `update self_hosted_object_mappings set deleted_at = $1, updated_at = $1
           where workspace_id = $2 and object_id = $3`,
          [Date.now(), binding.workspaceId, command.objectId]
        )
      }
      if (result.status === 'applied' && !stalePersonalAck && command.type === 'upsert-object' && command.objectId) {
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
  if (restoredPersonalSnapshot) await refreshBindingStores(binding)
  if (revisionConflicted) throw new Error('SELF_HOSTED_REVISION_CONFLICT')
  return activatedCollaborativeObject
}

async function personalAckHasNewerRevision(workspaceId: string, objectId: string, revision: string) {
  if (!/^\d+$/.test(revision)) return true
  const known = await (await getDb()).select<Array<{ revision: string }>>(
    `select revision from self_hosted_revisions where workspace_id = $1 and object_id = $2
     union all select revision from self_hosted_remote_objects where workspace_id = $1 and object_id = $2`,
    [workspaceId, objectId],
  )
  return known.some(item => !/^\d+$/.test(item.revision) || BigInt(item.revision) > BigInt(revision))
}

async function restoreAcceptedPersonalSnapshot(binding: Binding, row: OutboxRow, revision?: string) {
  if (binding.workspaceType !== 'account-data' || !revision || !/^\d+$/.test(revision)) return false
  const command = JSON.parse(row.payload) as Record<string, unknown>
  if (!['upsert-object', 'delete-object'].includes(String(command.type)) || typeof command.objectId !== 'string'
    || typeof command.kind !== 'string' || typeof command.keyVersion !== 'number'
    || typeof command.ciphertext !== 'string') return false
  const sourceIds = JSON.parse(row.sourceChangeIds) as number[]
  if (!sourceIds.length || sourceIds.some(id => !Number.isSafeInteger(id) || id < 1)) return false
  const payload = await decryptPackedJson<Record<string, unknown>>(
    await loadWorkspaceKey(binding.workspaceId, command.keyVersion), command.ciphertext,
    objectAssociatedData(binding.workspaceId, command.objectId, command.kind),
  )
  const context = { workspaceId: binding.workspaceId, objectId: command.objectId,
    kind: command.kind, revision, sourceIds, payload }
  if (!await restorePersonalSnapshotStillAllowed(context)) return false
  if (command.type === 'delete-object') {
    await applyRemoteDelete(binding, command.objectId)
    return true
  }
  if (payload.domain === 'mark' || payload.domain === 'message') {
    const profile = await getProfile(binding.profileId)
    if (!profile) return false
    await hydratePersonalAssets({ profileId: binding.profileId, workspaceId: binding.workspaceId,
      payload, enabled: profile.domainToggles.attachments !== false })
  }
  // Decryption, attachment downloads and profile reads can yield to a newer
  // edit or deletion. Re-read the complete restore guard before changing rows.
  if (!await restorePersonalSnapshotStillAllowed(context)) return false
  await applyStructuredPayload(binding.workspaceId, command.objectId, command.kind as SyncObjectKind, payload)
  return true
}

async function restorePersonalSnapshotStillAllowed(input: {
  workspaceId: string; objectId: string; kind: string; revision: string
  sourceIds: number[]; payload: Record<string, unknown>
}) {
  const database = await getDb()
  const domain = typeof input.payload.domain === 'string' ? input.payload.domain : null
  if (!domain) return false
  const mappings = await database.select<Array<{ kind: string; localIdentity: string; deletedAt: number | null }>>(
    `select kind, local_identity as localIdentity, deleted_at as deletedAt from self_hosted_object_mappings
     where workspace_id = $1 and object_id = $2 limit 1`, [input.workspaceId, input.objectId],
  )
  const mapping = mappings[0]
  if (!mapping || mapping.kind !== input.kind || mapping.deletedAt !== null
    || !mapping.localIdentity.startsWith(`${domain}:`)) return false
  const known = await database.select<Array<{ revision: string }>>(
    `select revision from self_hosted_revisions where workspace_id = $1 and object_id = $2
     union all select revision from self_hosted_remote_objects where workspace_id = $1 and object_id = $2`,
    [input.workspaceId, input.objectId],
  )
  if (known.some(item => !/^\d+$/.test(item.revision) || BigInt(item.revision) > BigInt(input.revision))) return false
  const sources = await database.select<Array<{ domain: string; localKey: string }>>(
    `select domain, local_key as localKey from self_hosted_local_changes
     where id in (select value from json_each($1)) and (workspace_id = $2 or workspace_id is null)`,
    [JSON.stringify(input.sourceIds), input.workspaceId],
  )
  if (sources.length !== new Set(input.sourceIds).size || sources.some(source => source.domain !== domain)) return false
  const aliases = new Set(sources.map(source => source.localKey))
  aliases.add(mapping.localIdentity.slice(domain.length + 1))
  if (typeof input.payload.localKey === 'string') aliases.add(input.payload.localKey)
  const value = input.payload.value && typeof input.payload.value === 'object' && !Array.isArray(input.payload.value)
    ? input.payload.value as Record<string, unknown> : {}
  for (const key of ['id', 'sourceId', 'syncId']) {
    if (typeof value[key] === 'string' || typeof value[key] === 'number') aliases.add(String(value[key]))
  }
  if (domain === 'mark' || domain === 'message' || domain === 'conversation') {
    const table = domain === 'mark' ? 'marks' : domain === 'message' ? 'chats' : 'conversations'
    const stableColumn = domain === 'mark' ? 'sourceId' : 'syncId'
    const rows = await database.select<Array<{ id: string; stableId: string | null; deleted: number }>>(
      `select cast(id as text) as id, ${stableColumn} as stableId, ${domain === 'mark' ? 'deleted' : '0'} as deleted
       from ${table} where cast(id as text) in (select value from json_each($1))
         or ${stableColumn} in (select value from json_each($1))`, [JSON.stringify([...aliases])],
    )
    if (rows.length > 1 || rows.some(row => row.deleted === 1)) return false
    for (const row of rows) {
      aliases.add(row.id)
      if (row.stableId) aliases.add(row.stableId)
    }
  }
  const references = input.payload.references && typeof input.payload.references === 'object' && !Array.isArray(input.payload.references)
    ? input.payload.references as Record<string, unknown> : {}
  if (domain === 'message' && (value.conversationId != null || typeof references.conversation === 'string')) {
    if (typeof references.conversation !== 'string') return false
    const parents = await database.select<Array<{ present: number }>>(
      `select 1 as present from self_hosted_object_mappings m join conversations c
         on m.local_identity = 'conversation:' || c.syncId
       where m.workspace_id = $1 and m.object_id = $2 and m.kind = 'conversation' and m.deleted_at is null limit 1`,
      [input.workspaceId, references.conversation],
    )
    if (!parents.length) return false
  }
  const newer = await database.select<Array<{ id: number }>>(
    `select id from self_hosted_local_changes where id > $1 and domain = $2
       and (workspace_id = $3 or workspace_id is null)
       and ($2 = 'setting' or local_key in (select value from json_each($4))) limit 1`,
    [input.sourceIds.reduce((latest, id) => Math.max(latest, id), 0), domain, input.workspaceId, JSON.stringify([...aliases])],
  )
  return newer.length === 0
}

async function assertNoUnresolvedRevisionCommands(workspaceId: string) {
  const rows = await (await getDb()).select<Array<{ commandId: string }>>(
    `select command_id as commandId from self_hosted_outbox where workspace_id = $1 and state = 'blocked'
       and (last_error_code = 'revision_conflict' or last_error_code like 'editor-resolution:%') limit 1`,
    [workspaceId],
  )
  if (rows.length) throw new Error('SELF_HOSTED_REVISION_CONFLICT')
}

async function preserveRejectedRevision(binding: Binding, row: OutboxRow, revision?: string) {
  const database = await getDb()
  const command = JSON.parse(row.payload) as Record<string, unknown>
  const objectId = typeof command.objectId === 'string' ? command.objectId : null
  const conflictId = `revision-conflict:${row.commandId}`
  const previous = await database.select<Array<{ path: string | null }>>(
    'select local_copy_path as path from self_hosted_conflicts where id = $1', [conflictId],
  )
  let payload: unknown = null
  if (objectId && typeof command.kind === 'string' && typeof command.ciphertext === 'string' && typeof command.keyVersion === 'number') {
    payload = await decryptPackedJson<unknown>(await loadWorkspaceKey(binding.workspaceId, command.keyVersion), command.ciphertext,
      objectAssociatedData(binding.workspaceId, objectId, command.kind))
  }
  const snapshot = JSON.stringify({ version: 1, workspaceId: binding.workspaceId, command, payload })
  const previousPath = previous[0]?.path
  const copyPath = previousPath && isRevisionConflictCopyPath(previousPath)
    ? previousPath : `self-hosted-conflict-backups/${crypto.randomUUID()}.json`
  await mkdir('self-hosted-conflict-backups', { baseDir: BaseDirectory.AppData, recursive: true })
  await writeFile(copyPath, new TextEncoder().encode(snapshot), { baseDir: BaseDirectory.AppData })
  // Persist the recovery copy before making the command non-retryable.
  await database.execute(`insert into self_hosted_conflicts(id, workspace_id, object_id, conflict_type,
      local_snapshot, remote_snapshot, local_copy_path, state, created_at)
    values ($1,$2,$3,'protocol-conflict',$4,$5,$6,'unresolved',$7)
    on conflict(id) do update set local_snapshot=excluded.local_snapshot,remote_snapshot=excluded.remote_snapshot,
      local_copy_path=excluded.local_copy_path,state='unresolved',resolved_at=null`,
  [conflictId, binding.workspaceId, objectId, snapshot, JSON.stringify({ revision: revision ?? null }), copyPath, Date.now()])
  await database.execute("update self_hosted_outbox set state='blocked',last_error_code='revision_conflict',next_attempt_at=0,updated_at=$1 where command_id=$2",
    [Date.now(), row.commandId])
}

async function releaseAcknowledgedRevisionConflicts(binding: Binding) {
  const database = await getDb()
  const rows = await database.select<Array<{ commandId: string; sourceIds: string; copyPath: string | null }>>(
    `select o.command_id as commandId,o.source_change_ids as sourceIds,c.local_copy_path as copyPath
     from self_hosted_outbox o join self_hosted_conflicts c on c.id = 'revision-conflict:' || o.command_id
     where o.workspace_id=$1 and o.state='blocked' and o.last_error_code='revision_conflict'
       and c.state='resolved-local-kept'`, [binding.workspaceId],
  )
  for (const row of rows) {
    if (!row.copyPath || !isRevisionConflictCopyPath(row.copyPath)
      || !await exists(row.copyPath, { baseDir: BaseDirectory.AppData })) throw new Error('SELF_HOSTED_REVISION_CONFLICT')
    try {
      const saved = JSON.parse(await readTextFile(row.copyPath, { baseDir: BaseDirectory.AppData })) as {
        command?: { commandId?: unknown }
      }
      if (saved.command?.commandId !== row.commandId) throw new Error('invalid_recovery_copy')
    } catch {
      throw new Error('SELF_HOSTED_REVISION_CONFLICT')
    }
    for (const sourceId of JSON.parse(row.sourceIds) as number[]) {
      await database.execute("update self_hosted_local_changes set state='superseded',updated_at=$1 where id=$2 and state='queued'",
        [Date.now(), sourceId])
    }
    // Acknowledging the preserved copy accepts the remote version. Never
    // turn the rejected command into a forced overwrite with a new base.
    await database.execute("update self_hosted_outbox set state='superseded',last_error_code='revision_conflict-copy-kept',updated_at=$1 where command_id=$2",
      [Date.now(), row.commandId])
  }
  return rows.length > 0
}

function isRevisionConflictCopyPath(path: string) {
  return /^self-hosted-conflict-backups\/[a-f0-9-]+\.json$/.test(path)
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

async function pullEvents(binding: Binding, session: SyncSession, onProgress?: (progress: SyncItemProgress) => void) {
  const database = await getDb()
  const { client } = await authenticatedClient(binding.profileId)
  let cursor = binding.pulledSequence
  let hasMore = true
  let received = 0
  while (hasMore) {
    onProgress?.({ current: received, total: 0 })
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
    received += page.events.length
    await updatePulledCursor(binding.workspaceId, cursor)
    onProgress?.({ current: received, total: hasMore ? 0 : received })
  }
}

async function applyInbox(
  binding: Binding,
  deviceId: string | null,
  isDocumentSubscribed: (objectId: string) => boolean,
  onProgress?: (progress: SyncItemProgress) => void,
  onRefresh?: () => void,
): Promise<{ through: string; error?: Error }> {
  const database = await getDb()
  const rows = await database.select<Array<{ sequence: string; payload: string; state: string }>>(
    `select sequence, payload, state from self_hosted_inbox
     where workspace_id = $1 and state in ('pending', 'failed', 'applied')
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
  let applicationError: Error | undefined
  let cursorBlocked = false
  const blockedObjects = new Set<string>()
  onProgress?.({ current: 0, total: parsedRows.length })
  for (const [index, row] of parsedRows.entries()) {
    const event = row.event
    const path = event.objectId ?? undefined
    onProgress?.({ path, current: index, total: parsedRows.length })
    if (row.state === 'applied') {
      // A suspended/crashed process may have committed this row before it
      // saved the applied cursor. Recover the contiguous applied prefix;
      // pending or failed rows still pass through the normal apply gate.
      if (!cursorBlocked) through = event.sequence
      if (isCoalescibleSnapshot(event)) bindingStoresChanged = true
      onProgress?.({ path, current: index + 1, total: parsedRows.length })
      continue
    }
    if (event.objectId && blockedObjects.has(event.objectId)) continue
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
      if (!cursorBlocked) through = event.sequence
      onProgress?.({ path, current: index + 1, total: parsedRows.length })
    } catch (error) {
      if (error instanceof PendingPathMove || error instanceof PendingLocalChange) {
        await database.execute(
          "update self_hosted_inbox set state = 'pending', error_code = $1 where workspace_id = $2 and sequence = $3",
          [error.message, binding.workspaceId, event.sequence],
        )
        applicationError ??= error
        cursorBlocked = true
        if (event.objectId) blockedObjects.add(event.objectId)
        if (binding.workspaceType === 'account-data') continue
        break
      }
      await database.execute(
        "update self_hosted_inbox set state = 'failed', error_code = $1 where workspace_id = $2 and sequence = $3",
        [String(error instanceof Error ? error.message : error).slice(0, 120), binding.workspaceId, event.sequence]
      )
      applicationError ??= error instanceof Error ? error : new Error(String(error))
      cursorBlocked = true
      if (event.objectId) blockedObjects.add(event.objectId)
      if (binding.workspaceType === 'account-data') continue
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
  if (bindingStoresChanged) {
    onRefresh?.()
    await refreshBindingStores(binding)
  }
  return { through, error: applicationError }
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
    const [{ default: useMarkStore }, { default: useTagStore }, { default: useCanvasStore }, { default: useChatStore }, { default: useMemoriesStore }] = await Promise.all([
      import('@/stores/mark'),
      import('@/stores/tag'),
      import('@/stores/canvas'),
      import('@/stores/chat'),
      import('@/stores/memories'),
    ])
    const markState = useMarkStore.getState()
    const chatState = useChatStore.getState()
    const currentConversationId = chatState.currentConversationId
    await useTagStore.getState().fetchTags()
    await Promise.all([
      markState.fetchAllMarks(),
      markState.trashState ? markState.fetchAllTrashMarks()
        : (await import('@/lib/check')).isMobileDevice() ? markState.fetchMarkPreviews(true) : markState.fetchMarks(),
      useCanvasStore.getState().loadProjects(),
      chatState.initConversations(),
      useMemoriesStore.getState().loadMemories(),
      useMemoriesStore.getState().loadStats(),
      useMemoriesStore.getState().loadPolicy(),
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

async function applyRemoteEvent(binding: Binding, event: SyncEvent, beforeStructuredApply?: (payload: Record<string, unknown>) => Promise<void>) {
  if (binding.workspaceType === 'library') {
    return withSelfHostedPrepareLock(binding.workspaceId, () => applyRemoteEventRaw(binding, event))
  }
  return applyRemoteEventRaw(binding, event, beforeStructuredApply)
}

async function applyRemoteEventRaw(binding: Binding, event: SyncEvent, beforeStructuredApply?: (payload: Record<string, unknown>) => Promise<void>) {
  if (!await shouldApplyPersonalEvent(binding, event)) return
  const database = await getDb()
  if (event.type === 'conflict.created' || event.type === 'conflict.resolved') {
    const conflictId = String(event.metadata.conflictId ?? event.eventId)
    if (event.type === 'conflict.created') {
      await recordProtocolConflict(binding.workspaceId, event.objectId ?? undefined, conflictId)
    } else {
      await database.execute(
        "update self_hosted_conflicts set state = 'resolved', resolved_at = $1 where workspace_id = $2 and id = $3",
        [Date.now(), binding.workspaceId, conflictId],
      )
    }
    return
  }
  if (!event.objectId) return
  if (binding.workspaceType === 'account-data' && isCoalescibleSnapshot(event)
    && typeof event.metadata.revision === 'string'
    && await personalAckHasNewerRevision(binding.workspaceId, event.objectId, event.metadata.revision)) return
  if (!beforeStructuredApply || event.type === 'object.deleted') await assertPersonalRemoteApplyAllowed(binding, event)
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
    const target = await resolveRemoteDeleteTarget(binding, event)
    await assertPersonalRemoteApplyAllowed(binding, { ...event, objectId: target })
    await applyRemoteDelete(binding, target)
    if (binding.workspaceType === 'account-data') {
      await database.execute('delete from self_hosted_remote_objects where workspace_id = $1 and object_id = $2',
        [binding.workspaceId, event.objectId])
    }
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
  if (!beforeStructuredApply) await assertPersonalRemoteApplyAllowed(binding, event, payload)
  if (binding.workspaceType === 'account-data' && payload.domain === 'message') {
    const references = payload.references
    const conversation = references && typeof references === 'object' && !Array.isArray(references)
      ? (references as Record<string, unknown>).conversation : undefined
    if (typeof conversation === 'string') {
      const deletedParents = await database.select<Array<{ deletedAt: number }>>(
        `select deleted_at as deletedAt from self_hosted_object_mappings
         where workspace_id = $1 and object_id = $2 and kind = 'conversation' and deleted_at is not null limit 1`,
        [binding.workspaceId, conversation],
      )
      if (deletedParents[0]) {
        const target = await resolveRemoteDeleteTarget(binding, event)
        await assertPersonalRemoteApplyAllowed(binding, { ...event, objectId: target })
        await applyRemoteDelete(binding, target)
        await database.execute('delete from self_hosted_remote_objects where workspace_id = $1 and object_id = $2',
          [binding.workspaceId, event.objectId])
        return
      }
    }
  }
  if (binding.workspaceType === 'account-data' && (payload.domain === 'mark' || payload.domain === 'message')) {
    const profile = await getProfile(binding.profileId)
    if (!profile) throw new Error('自托管同步配置不存在')
    await hydratePersonalAssets({
      profileId: binding.profileId,
      workspaceId: binding.workspaceId,
      payload,
      enabled: profile.domainToggles.attachments !== false,
    })
  }
  if (binding.workspaceType === 'library' && payload.domain === 'canvas') return
  if (binding.workspaceType === 'library' && typeof payload.relativePath === 'string') {
    await assertNoPendingPathMove(binding, payload.relativePath)
  }
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
  // Downloads and dependency resolution may have yielded to a new local edit.
  if (beforeStructuredApply) {
    await beforeStructuredApply(payload)
    await assertPersonalRemoteApplyAllowed(binding, event, payload, true)
  } else await assertPersonalRemoteApplyAllowed(binding, event, payload)
  await applyStructuredPayload(binding.workspaceId, event.objectId, kind as SyncObjectKind, payload)
  await database.execute(
    `insert into self_hosted_remote_objects(workspace_id, object_id, kind, revision, payload, updated_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict(workspace_id, object_id) do update set
       kind = excluded.kind, revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at`,
    [binding.workspaceId, event.objectId, kind, String(event.metadata.revision ?? '0'), JSON.stringify(payload), Date.now()]
  )
}

async function shouldApplyPersonalEvent(binding: Binding, event: SyncEvent) {
  if (binding.workspaceType !== 'account-data') return true
  if (event.type === 'conflict.created' || event.type === 'conflict.resolved') return true
  const profile = await getProfile(binding.profileId)
  if (!profile) throw new Error('自托管同步配置不存在')
  let kind = typeof event.metadata.kind === 'string' ? event.metadata.kind : null
  if (!kind && event.objectId) {
    const mappings = await (await getDb()).select<Array<{ kind: string }>>(
      'select kind from self_hosted_object_mappings where workspace_id = $1 and object_id = $2 limit 1',
      [binding.workspaceId, event.objectId],
    )
    kind = mappings[0]?.kind ?? null
  }
  return kind !== null && isPersonalSyncKindEnabled(kind, profile.domainToggles, event.type === 'object.deleted')
}

async function assertPersonalRemoteApplyAllowed(
  binding: Binding, event: SyncEvent, payload?: Record<string, unknown>, allowRestoredSnapshots = false,
) {
  if (await hasPendingPersonalMutation(binding, event, payload, allowRestoredSnapshots)) throw new PendingLocalChange()
}

async function resolveRemoteDeleteTarget(binding: Binding, event: SyncEvent) {
  const database = await getDb()
  const direct = await database.select<Array<{ objectId: string }>>(
    `select object_id as objectId from self_hosted_object_mappings
     where workspace_id = $1 and object_id = $2 limit 1`,
    [binding.workspaceId, event.objectId]
  )
  if (direct[0]) return direct[0].objectId
  if (binding.workspaceType === 'account-data') {
    // A remote SQLite key belongs to the source device. An unmapped tombstone
    // must never claim another local object's row through that numeric key.
    const kind = String(event.metadata.kind ?? '')
    if (!isPersonalSyncKindEnabled(kind, {}, true)) return event.objectId!
    await database.execute(`insert or ignore into self_hosted_object_mappings(
        workspace_id, object_id, kind, local_identity, deleted_at, updated_at)
      values ($1, $2, $3, $4, $5, $5)`,
    [binding.workspaceId, event.objectId, kind, `superseded:${kind}:${event.objectId}`, Date.now()])
    return event.objectId!
  }
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
    associatedData: typeof payload.associatedData === 'string' ? payload.associatedData : undefined,
  })
  await assertNoPendingPathMove(binding, relativePath)
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
    await assertNoPendingPathMove(binding, mapping.relativePath)
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
      await assertNoPendingPathMove(binding, folder.relativePath)
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
    } catch (error) {
      if (error instanceof PendingPathMove) continue
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
    associatedData: typeof payload.associatedData === 'string' ? payload.associatedData : undefined,
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

async function preserveBootstrapPendingPersonalChanges(
  binding: Binding, event: SyncEvent, session: SyncSession, payload: Record<string, unknown>,
) {
  if (binding.workspaceType !== 'account-data' || !event.objectId) return
  const database = await getDb()
  const pendingForObject = () => pendingPersonalChangesForEvent(binding, event, payload)
  // The remote attachment hydration runs first. A missing local asset which
  // exists on the server can therefore be recovered before capturing its row.
  // Retry this object's preparation immediately, even when another attempted
  // object set a backoff before the attachment became available.
  for (const change of await pendingForObject()) {
    await database.execute('update self_hosted_local_changes set next_attempt_at = 0 where id = $1', [change.id])
  }
  let hasMore: boolean
  do {
    const prepared = await materializeOutbox(
      binding.workspaceId, binding.workspaceType, binding.localRoot,
      session.limits.maxCommandsPerBatch, binding.profileId, session.syncEpoch,
      Math.max(1, ...session.keyVersions.map(key => key.keyVersion)), session.limits.maxObjectBytes,
    )
    hasMore = prepared.hasMore
  } while (hasMore)
  // An unrelated bad attachment remains pending without preventing healthy
  // objects from applying. Only refuse to overwrite the row still holding an
  // uncaptured local edit; its bootstrap failure remains durable and retryable.
  if ((await pendingForObject()).length) throw new Error('personal_bootstrap_local_change_not_preserved')
  await database.execute(
    `update self_hosted_outbox set restore_local_snapshot = 1
     where workspace_id = $1 and json_extract(payload, '$.objectId') = $2
       and json_extract(payload, '$.type') = 'upsert-object' and state in ('pending', 'retry', 'blocked')`,
    [binding.workspaceId, event.objectId],
  )
}

async function bootstrapBinding(
  binding: Binding,
  session: SyncSession,
  errors: Set<string>,
  onProgress?: (progress: SyncItemProgress) => void,
) {
  const { client } = await authenticatedClient(binding.profileId)
  const profile = await getProfile(binding.profileId)
  if (!profile) throw new Error('自托管同步配置不存在')
  return client.withBootstrapSnapshot(binding.workspaceId, session.syncEpoch, async readPage => {
    let bootstrapId: string | undefined
    let afterObjectId: string | undefined
    let snapshotSequence = '0'
    const objects: SyncBootstrapPage['objects'] = []
    const conflicts: Array<Record<string, unknown>> = []
    do {
      onProgress?.({ current: objects.length, total: 0 })
      const page = await readPage(
        bootstrapId,
        afterObjectId,
        session.limits.maxBootstrapObjectsPerPage,
      )
      bootstrapId = page.bootstrapId
      snapshotSequence = page.snapshotSequence
      objects.push(...page.objects)
      conflicts.push(...page.conflicts)
      afterObjectId = page.nextObjectId ?? undefined
      onProgress?.({ current: objects.length, total: afterObjectId ? 0 : objects.length })
    } while (afterObjectId)
    if (binding.workspaceType === 'account-data' && objects.some(object => object.kind === 'conversation' && object.deletedAt !== null)) {
      const entries: SelfHostedSnapshotObject[] = []
      for (const object of objects) {
        let payload: Record<string, unknown> = {}
        if (object.kind === 'message' && object.deletedAt === null) {
          try {
            const key = await loadWorkspaceKey(binding.workspaceId, object.keyVersion)
            payload = await decryptPackedJson<Record<string, unknown>>(
              key, object.ciphertext, objectAssociatedData(binding.workspaceId, object.objectId, object.kind),
            )
          } catch {
            // Keep the normal per-object apply path responsible for reporting
            // malformed/encrypted objects and its isolated failure accounting.
          }
        }
        entries.push({ object, payload })
      }
      const effective = applyConversationTombstones(entries)
      for (let index = 0; index < objects.length; index++) objects[index] = effective[index].object
    }
    const priority: Partial<Record<SyncObjectKind, number>> = {
      tag: 0, conversation: 0, folder: 0,
      mark: 1, note: 1, message: 1, asset: 1, canvas: 2,
    }
    objects.sort((left, right) => {
      const deletionOrder = Number(left.deletedAt === null) - Number(right.deletedAt === null)
      if (deletionOrder !== 0) return deletionOrder
      return (priority[left.kind] ?? 2) - (priority[right.kind] ?? 2)
    })
    let skippedObjects = 0
    const appliedObjectIds: string[] = []
    for (const [index, object] of objects.entries()) {
      onProgress?.({ path: object.objectId, current: index, total: objects.length })
      if (binding.workspaceType === 'account-data'
        && !isPersonalSyncKindEnabled(object.kind, profile.domainToggles, object.deletedAt !== null)) continue
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
        await applyRemoteEvent(binding, event, payload => preserveBootstrapPendingPersonalChanges(binding, event, session, payload))
      } catch (error) {
        if (error instanceof PendingPathMove) throw error
        if (error instanceof PendingLocalChange) errors.add(error.message)
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
      appliedObjectIds.push(object.objectId)
    }
    onProgress?.({ current: objects.length, total: objects.length })
    if (appliedObjectIds.length > 0) {
      await (await getDb()).execute(
        `update self_hosted_conflicts set state = 'resolved', resolved_at = $1
         where workspace_id = $2 and conflict_type = 'bootstrap-apply-failed'
           and state = 'unresolved' and object_id in (select value from json_each($3))`,
        [Date.now(), binding.workspaceId, JSON.stringify(appliedObjectIds)],
      )
    }
    if (skippedObjects > 0) throw new Error(`bootstrap_apply_incomplete:${skippedObjects}/${objects.length}`)
    // Complete only after every enabled object has been materialized. Resolve
    // stale failures for removed or intentionally paused objects as well.
    await (await getDb()).execute(
      `update self_hosted_conflicts set state = 'resolved', resolved_at = $1
       where workspace_id = $2 and conflict_type = 'bootstrap-apply-failed' and state <> 'resolved'`,
      [Date.now(), binding.workspaceId],
    )
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
  })
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

      await assertNoPendingPathMove(binding, relativePath)

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
      emitter.emit('sync-content-updated', { path: relativePath, content: snapshot.content, workspaceRoot: binding.localRoot! })
      appliedSnapshot = snapshot
      return true
    },
  )
  if (!accepted) throw new Error('remote_file_local_activity')
  if (!appliedSnapshot) throw new Error('remote_file_snapshot_missing')
  return appliedSnapshot
}

export async function writeResolvedSelfHostedNoteSnapshot(input: {
  workspaceId: string
  objectId: string
  relativePath: string
  expectedContent: string | null
  content: string
  assertCurrent: () => void
}) {
  const binding = (await listBindings()).find(item => item.workspaceId === input.workspaceId)
  if (!binding?.localRoot || binding.workspaceType !== 'library' || binding.bindingState !== 'bound') {
    throw new Error('SELF_HOSTED_NOTE_CONFLICT_UNAVAILABLE')
  }
  await writeRemoteEditorSnapshot(binding, input.objectId, input.relativePath, async current => {
    input.assertCurrent()
    if (current !== input.expectedContent) throw new Error('SELF_HOSTED_NOTE_CONFLICT_CHANGED')
    return { content: input.content, merged: false, conflict: null }
  })
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
  await assertNoPendingPathMove(binding, relativePath)
  await invoke('self_hosted_atomic_write', {
    workspaceId: binding.workspaceId,
    objectId,
    workspaceRoot: binding.localRoot,
    relativePath,
    contents: bytesToBase64Url(content),
    expectedHash: await hashBytes(content),
  })
}

async function pendingPathMovesForBinding(binding: Binding): Promise<Array<{ source: string; target: string }>> {
  if (binding.workspaceType !== 'library' || !binding.localRoot) return []
  const normalize = (path: string) => path.normalize('NFC').replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalize(binding.localRoot) !== normalize(await getCurrentWorkspaceRoot())) return []
  if (await (await Store.load('store.json')).get<string>('primaryBackupMethod') !== 'selfHosted') return []
  const { getPendingWorkspacePathMoves } = await import('@/lib/sync/workspace-path-moves')
  return getPendingWorkspacePathMoves()
}

async function assertNoPendingPathMove(binding: Binding, relativePath: string) {
  const normalize = (path: string) => path.normalize('NFC').replaceAll('\\', '/').replace(/\/+$/, '')
  const path = normalize(relativePath).toLowerCase()
  const moves = await pendingPathMovesForBinding(binding)
  if (moves.some(move => [move.source, move.target].some(value => {
    const root = normalize(value).toLowerCase()
    return path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`)
  }))) {
    // Keep the inbox event and cursor pending. A remote snapshot must not
    // recreate a locally renamed source or apply an intermediate chain path.
    throw new PendingPathMove()
  }
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
  if (binding.workspaceType === 'account-data') {
    const database = await getDb()
    if (command.type === 'upsert-object' && command.kind && command.ciphertext && command.keyVersion) {
      const payload = await decryptPackedJson<Record<string, unknown>>(
        await loadWorkspaceKey(binding.workspaceId, command.keyVersion), command.ciphertext,
        objectAssociatedData(binding.workspaceId, command.objectId, command.kind),
      )
      // This is the frozen, accepted payload, never the current editable row.
      // Do not regress a newer remote base that another apply already cached.
      await database.execute(
        `insert into self_hosted_remote_objects(workspace_id, object_id, kind, revision, payload, updated_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict(workspace_id, object_id) do update set
           kind = excluded.kind, revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at
         where cast(self_hosted_remote_objects.revision as integer) <= cast(excluded.revision as integer)`,
        [binding.workspaceId, command.objectId, command.kind, revision, JSON.stringify(payload), Date.now()],
      )
    } else if (command.type === 'delete-object') {
      await database.execute(
        `delete from self_hosted_remote_objects where workspace_id = $1 and object_id = $2
           and cast(revision as integer) <= cast($3 as integer)`,
        [binding.workspaceId, command.objectId, revision],
      )
    }
  }
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
