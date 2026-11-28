import * as Y from 'yjs'
import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, exists, mkdir, readTextFile, writeFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { executeRecordTransaction, getDb, type RecordStatement } from '@/db'
import emitter from '@/lib/emitter'
import { isSyncStaleError } from '@/lib/sync/sync-stale-error'
import {
  getCurrentEditorWorkspaceRoot, getEditorPathMutationRevision,
  workspaceRootsReferToSameLocation,
} from '@/lib/editor-deactivation'
import { authenticatedClient } from './profile'
import { decryptPackedJson, encryptJson, loadWorkspaceKey, objectAssociatedData } from './crypto'
import { bytesToBase64Url, uploadAssetBytes, base64UrlByteLength } from './blob'
import { pauseSelfHostedDocumentCollaboration, pushDocumentInitialization, waitForSelfHostedCollaborationIdle } from './collaboration'
import { applyMarkdownText, createMarkdownInitializationUpdate, readMarkdownSnapshot } from './markdown-state'
import { getSelfHostedSyncRuntime, writeResolvedSelfHostedNoteSnapshot } from './runtime'
import { readSwitchDocument } from './switch-document'
import { withSelfHostedPrepareLock } from './prepare-lock'
import { ensureManagedWorkspaceKeys } from './workspaces'

export interface SelfHostedNoteConflictSummary {
  id: string
  workspaceId: string
  relativePath: string
  localRoot: string
  conflictType: string
  createdAt: number
}

interface ConflictRow extends SelfHostedNoteConflictSummary {
  objectId: string
  profileId: string
  localSnapshot: string | null
  remoteSnapshot: string | null
  baseSnapshot: string | null
  localCopyPath: string | null
}

export interface SelfHostedNoteConflictPreview extends SelfHostedNoteConflictSummary {
  objectId: string
  profileId: string
  localContent: string
  remoteContent: string
  baseContent: string | null
  remoteRevision: string
  remoteFileContent: string
  remoteDocument: { id: string; sequence: string; content: string; update: Uint8Array } | null
  localMutationRevision: number
  localFileContent: string | null
  conflictSnapshot: string | null
  syncEpoch: string
  maxObjectBytes: number
  keyVersion: number
}

const CHANGED = 'SELF_HOSTED_NOTE_CONFLICT_CHANGED'
const UNAVAILABLE = 'SELF_HOSTED_NOTE_CONFLICT_UNAVAILABLE'
const UNSUPPORTED = 'SELF_HOSTED_NOTE_CONFLICT_UNSUPPORTED'

async function conflictRows(id?: string) {
  return (await getDb()).select<ConflictRow[]>(
    `select c.id, c.workspace_id as workspaceId, c.object_id as objectId,
       c.conflict_type as conflictType, c.created_at as createdAt,
       c.local_snapshot as localSnapshot, c.remote_snapshot as remoteSnapshot,
       c.base_snapshot as baseSnapshot, c.local_copy_path as localCopyPath,
       b.local_root as localRoot, b.profile_id as profileId, m.relative_path as relativePath
     from self_hosted_conflicts c
     join self_hosted_workspace_bindings b on b.workspace_id = c.workspace_id
     join self_hosted_sync_profiles p on p.id = b.profile_id and p.state = 'connected'
     join self_hosted_object_mappings m on m.workspace_id = c.workspace_id and m.object_id = c.object_id
     where c.state = 'unresolved' and b.workspace_type = 'library' and b.binding_state = 'bound'
       and b.local_root is not null and b.access_mode <> 'read-only'
       and m.kind = 'note' and m.relative_path is not null and m.deleted_at is null
       and (c.conflict_type = 'snapshot-diverged' or (c.conflict_type = 'protocol-conflict'
         and exists (select 1 from self_hosted_outbox o where c.id = 'revision-conflict:' || o.command_id
           and o.workspace_id = c.workspace_id and o.state = 'blocked' and o.last_error_code = 'revision_conflict'
           and json_extract(o.payload, '$.kind') = 'note' and json_extract(o.payload, '$.type') = 'upsert-object')))
       and ($1 is null or c.id = $1)
     order by c.created_at desc`, [id ?? null],
  )
}

export async function listSelfHostedNoteConflicts(): Promise<SelfHostedNoteConflictSummary[]> {
  const root = await getCurrentEditorWorkspaceRoot()
  return (await conflictRows()).filter(row => workspaceRootsReferToSameLocation(root, row.localRoot))
    .map(({ id, workspaceId, relativePath, localRoot, conflictType, createdAt }) => (
      { id, workspaceId, relativePath, localRoot, conflictType, createdAt }
    ))
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(UNSUPPORTED)
  return value as Record<string, unknown>
}

function markdownText(document: Y.Doc) {
  const legacy = document.getText('markdown')
  const legacyV2 = document.getMap<Y.Text>('markdown-v2')
  const text = document.getText('markdown-v3')
  const metadata = document.getMap('markdown-v3-meta')
  if (metadata.get('initialized') === true) return text
  const v2 = legacyV2.get('content')
  if (v2 instanceof Y.Text) return v2
  if (legacy.length > 0) return legacy
  throw new Error(UNSUPPORTED)
}

function createDocument() {
  const document = new Y.Doc()
  document.getText('markdown')
  document.getMap<Y.Text>('markdown-v2')
  document.getText('markdown-v3')
  document.getMap('markdown-v3-meta')
  return document
}

async function loadRemote(row: ConflictRow) {
  const { client } = await authenticatedClient(row.profileId)
  const session = await client.syncSession(row.workspaceId, '0')
  if (!session.protocol.compatible || !session.workspace.capabilities.includes('history.restore')
    || !session.workspace.capabilities.includes('content.update')) throw new Error(UNAVAILABLE)
  await ensureManagedWorkspaceKeys(row.profileId, row.workspaceId, session.keyVersions.map(key => key.keyVersion))
  const object = await client.withBootstrapSnapshot(row.workspaceId, session.syncEpoch, async readPage => {
    let bootstrapId: string | undefined
    let after: string | undefined
    for (let count = 0; count < 10_000; count++) {
      const page = await readPage(bootstrapId, after, session.limits.maxBootstrapObjectsPerPage)
      const found = page.objects.find(item => item.objectId === row.objectId)
      if (found) return found
      if (!page.hasMore || !page.nextObjectId) return null
      bootstrapId = page.bootstrapId
      after = page.nextObjectId
    }
    throw new Error(UNSUPPORTED)
  })
  if (!object || object.deletedAt !== null || object.kind !== 'note') throw new Error(UNAVAILABLE)
  const aad = objectAssociatedData(row.workspaceId, row.objectId, 'note')
  const payload = record(await decryptPackedJson<unknown>(await loadWorkspaceKey(row.workspaceId, object.keyVersion), object.ciphertext, aad))
  if (payload.domain !== 'file' || payload.relativePath !== row.relativePath) throw new Error(UNAVAILABLE)
  const remoteFileContent = await readMarkdownSnapshot(row, payload, object.keyVersion)
  let remoteContent = remoteFileContent
  let remoteDocument: SelfHostedNoteConflictPreview['remoteDocument'] = null
  if (object.document) {
    const state = await readSwitchDocument(client, row.workspaceId, object, session.syncEpoch,
      version => loadWorkspaceKey(row.workspaceId, version)).catch(error => {
      if (isSyncStaleError(error)) throw new Error(CHANGED)
      throw error
    })
    if (!state) throw new Error(UNAVAILABLE)
    try {
      if (state.document.store.pendingStructs || state.document.store.pendingDs) throw new Error(UNSUPPORTED)
      const content = markdownText(state.document).toString()
      const onlyInitialSeed = state.sequence === '1' && state.document.getMap('markdown-v3-meta').get('initialized') === true
      remoteDocument = { id: object.document.documentId, sequence: state.sequence, content,
        update: Y.encodeStateAsUpdate(state.document) }
      if (row.id.startsWith('setup-conflict:')) {
        remoteContent = content
      } else if (!onlyInitialSeed && content !== remoteFileContent) {
        // A file conflict follows the accepted object revision. A seed alone
        // is not an edit, and older clients could seed with the rejected file.
        // Prefer collaboration only when its edits cover or follow that revision.
        const version = await client.latestObjectVersion(row.workspaceId, row.objectId, session.syncEpoch)
        if (version?.revision !== object.currentRevision) throw new Error(CHANGED)
        const currentCheckpoint = object.document.materializedRevision === object.currentRevision
          && BigInt(object.document.checkpointDocumentSequence) > BigInt(1)
        const newerEdits = state.latestUpdateEventSequence !== null
          && BigInt(state.latestUpdateEventSequence) > BigInt(version.sequence)
        if (currentCheckpoint || newerEdits) remoteContent = content
      }
    } finally { state.document.destroy() }
  }
  return {
    remoteContent, remoteFileContent, remoteRevision: object.currentRevision, remoteDocument, syncEpoch: session.syncEpoch,
    maxObjectBytes: session.limits.maxObjectBytes,
    keyVersion: Math.max(object.keyVersion, ...session.keyVersions.map(key => key.keyVersion)),
  }
}

export async function loadSelfHostedNoteConflict(id: string): Promise<SelfHostedNoteConflictPreview> {
  const row = (await conflictRows(id))[0]
  if (!row || !workspaceRootsReferToSameLocation(await getCurrentEditorWorkspaceRoot(), row.localRoot)) throw new Error(UNAVAILABLE)
  const portable = await invoke<{ normalized: string }>('self_hosted_portable_path', { relativePath: row.relativePath })
  if (portable.normalized !== row.relativePath) throw new Error(UNAVAILABLE)
  const absolutePath = await join(row.localRoot, row.relativePath)
  const localFileContent = await exists(absolutePath) ? await readTextFile(absolutePath) : null
  const localMutationRevision = getEditorPathMutationRevision(row.relativePath, row.localRoot)
  let localContent = row.localSnapshot
  let rejectedContent: string | null = null
  if (row.id.startsWith('revision-conflict:')) {
    if (!row.localSnapshot) throw new Error(UNSUPPORTED)
    const saved = record(JSON.parse(row.localSnapshot))
    const command = record(saved.command)
    const payload = record(saved.payload)
    if (command.objectId !== row.objectId || command.kind !== 'note' || payload.domain !== 'file'
      || payload.relativePath !== row.relativePath || typeof command.keyVersion !== 'number') throw new Error(UNSUPPORTED)
    rejectedContent = await readMarkdownSnapshot(row, payload, command.keyVersion)
    localContent = localFileContent ?? rejectedContent
  }
  if (localContent === null) throw new Error(UNSUPPORTED)
  const remote = await loadRemote(row)
  if (rejectedContent !== null && localFileContent === remote.remoteContent) localContent = rejectedContent
  if (localMutationRevision !== getEditorPathMutationRevision(row.relativePath, row.localRoot)) throw new Error(CHANGED)
  return {
    id: row.id, workspaceId: row.workspaceId, relativePath: row.relativePath, localRoot: row.localRoot,
    conflictType: row.conflictType, createdAt: row.createdAt, objectId: row.objectId, profileId: row.profileId,
    localContent, baseContent: row.baseSnapshot, localFileContent, localMutationRevision,
    conflictSnapshot: row.localSnapshot, ...remote,
  }
}

async function closeResolutionReports(preview: SelfHostedNoteConflictPreview) {
  const database = await getDb()
  const reports = await database.select<Array<{ commandId: string; payload: string }>>(
    `select command_id as commandId,payload from self_hosted_outbox
     where workspace_id=$1 and command_type='create-conflict' and state='blocked' and last_error_code=$2`,
    [preview.workspaceId, `editor-resolution:${preview.id}`],
  )
  if (!reports.length) return
  const { client } = await authenticatedClient(preview.profileId)
  for (const report of reports) {
    const command = record(JSON.parse(report.payload))
    if (command.objectId !== preview.objectId || typeof command.conflictId !== 'string') throw new Error(UNSUPPORTED)
    const created = (await client.pushCommands(preview.workspaceId, [command], preview.syncEpoch)).results[0]
    if (created?.status === 'applied' && created.sequence) {
      const closed = (await client.pushCommands(preview.workspaceId, [{
        commandId: crypto.randomUUID(), type: 'resolve-conflict', conflictId: command.conflictId,
        expectedCreatedSequence: created.sequence,
      }], preview.syncEpoch)).results[0]
      if (closed?.status !== 'applied') throw new Error(closed?.code ?? UNAVAILABLE)
    } else if (created?.code !== 'conflict_changed') {
      throw new Error(created?.code ?? UNAVAILABLE)
    }
    await database.execute(
      "update self_hosted_outbox set state='superseded',last_error_code='editor-report-closed',updated_at=$1 where command_id=$2",
      [Date.now(), report.commandId],
    )
  }
}

export async function resolveSelfHostedNoteConflict(
  preview: SelfHostedNoteConflictPreview,
  content: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const runtime = getSelfHostedSyncRuntime()
  await runtime.withConflictResolution(async () => {
    const resume = pauseSelfHostedDocumentCollaboration(preview.workspaceId, preview.objectId)
    try {
      await waitForSelfHostedCollaborationIdle()
      await withSelfHostedPrepareLock(preview.workspaceId, async () => {
        const assertCurrent = () => {
          if (!isCurrent() || getEditorPathMutationRevision(preview.relativePath, preview.localRoot) !== preview.localMutationRevision) throw new Error(CHANGED)
        }
        const assertSameSnapshot = (current: SelfHostedNoteConflictPreview) => {
          if (current.workspaceId !== preview.workspaceId || current.objectId !== preview.objectId || current.profileId !== preview.profileId
            || current.relativePath !== preview.relativePath || current.localFileContent !== preview.localFileContent
            || current.conflictSnapshot !== preview.conflictSnapshot || current.syncEpoch !== preview.syncEpoch
            || current.remoteRevision !== preview.remoteRevision || current.remoteContent !== preview.remoteContent) throw new Error(CHANGED)
          assertCurrent()
        }
        const isMatchingInitialization = (document: SelfHostedNoteConflictPreview['remoteDocument']) => (
          document?.id === preview.objectId && document.sequence === '1' && document.content === preview.remoteContent
        )
        assertCurrent()
        const database = await getDb()
        const retired = await database.select<Array<{ commandId: string; sourceIds: string; payload: string }>>(
          `select command_id as commandId, source_change_ids as sourceIds, payload from self_hosted_outbox
           where workspace_id = $1 and (((state in ('pending','retry')
               or (state='blocked' and command_type in ('append-update','commit-checkpoint')))
             and (json_extract(payload, '$.objectId') = $2 or json_extract(payload, '$.documentId') = $2))
             or command_id = $3)`,
          [preview.workspaceId, preview.objectId, preview.id.startsWith('revision-conflict:') ? preview.id.slice('revision-conflict:'.length) : ''],
        )
        const backupPath = `self-hosted-conflict-backups/${crypto.randomUUID()}.json`
        await mkdir('self-hosted-conflict-backups', { baseDir: BaseDirectory.AppData, recursive: true })
        await writeFile(backupPath, new TextEncoder().encode(JSON.stringify({
          version: 1, conflictId: preview.id, workspaceId: preview.workspaceId,
          relativePath: preview.relativePath, localContent: preview.localContent,
          localFileContent: preview.localFileContent, remoteContent: preview.remoteContent,
          remoteFileContent: preview.remoteFileContent, remoteDocumentContent: preview.remoteDocument?.content ?? null,
          remoteRevision: preview.remoteRevision, remoteDocumentSequence: preview.remoteDocument?.sequence ?? null,
          baseContent: preview.baseContent, resolvedContent: content, retired,
        })), { baseDir: BaseDirectory.AppData })
        await closeResolutionReports(preview)
        const fresh = await loadSelfHostedNoteConflict(preview.id)
        assertSameSnapshot(fresh)
        let remoteDocument = fresh.remoteDocument
        if (preview.remoteDocument) {
          if (remoteDocument?.id !== preview.remoteDocument.id || remoteDocument.sequence !== preview.remoteDocument.sequence
            || remoteDocument.content !== preview.remoteDocument.content) throw new Error(CHANGED)
        } else if (remoteDocument && !isMatchingInitialization(remoteDocument)) throw new Error(CHANGED)

        const { client } = await authenticatedClient(preview.profileId)
        if (!remoteDocument) {
          // Resolve with both revisions protected, even for a note that's
          // never been opened collaboratively. Seed only the reviewed remote.
          const version = await client.currentObjectVersion(preview.workspaceId, preview.objectId, fresh.syncEpoch)
          if (version?.revision !== fresh.remoteRevision) throw new Error(CHANGED)
          const initialized = await pushDocumentInitialization(client, {
            workspaceId: preview.workspaceId, objectId: preview.objectId, documentId: preview.objectId,
            kind: 'note', keyVersion: fresh.keyVersion,
          }, fresh.syncEpoch, fresh.remoteRevision, createMarkdownInitializationUpdate(fresh.remoteContent), assertCurrent)
          if (initialized.status === 'applied') {
            if (initialized.documentSequence !== '1') throw new Error(CHANGED)
          } else if (initialized.code !== 'document_already_initialized') {
            throw new Error(initialized.code === 'document_object_inactive' || initialized.code === 'revision_conflict'
              ? CHANGED : initialized.code ?? UNAVAILABLE)
          }
          // Another edit can arrive after the guarded seed is accepted.
          const seeded = await loadSelfHostedNoteConflict(preview.id)
          assertSameSnapshot(seeded)
          remoteDocument = seeded.remoteDocument
          if (!remoteDocument || !isMatchingInitialization(remoteDocument)) throw new Error(CHANGED)
        }
        const key = await loadWorkspaceKey(preview.workspaceId, fresh.keyVersion)
        const aad = objectAssociatedData(preview.workspaceId, preview.objectId, 'note')
        let payload: Record<string, unknown> = { version: 1, domain: 'file', relativePath: preview.relativePath, content }
        let encrypted = await encryptJson(key, payload, aad)
        let blobRefs: string[] = []
        if (base64UrlByteLength(encrypted.packedCiphertext) > fresh.maxObjectBytes) {
          const blob = await uploadAssetBytes({
            profileId: preview.profileId, workspaceId: preview.workspaceId, syncEpoch: fresh.syncEpoch,
            localRoot: preview.localRoot, relativePath: preview.relativePath, keyVersion: fresh.keyVersion,
            plaintext: new TextEncoder().encode(content),
          })
          payload = { version: 1, domain: 'file', relativePath: preview.relativePath,
            blobId: blob.blobId, size: blob.size, plaintextHash: blob.plaintextHash, associatedData: blob.associatedData }
          blobRefs = [blob.blobId]
          encrypted = await encryptJson(key, payload, aad)
        }
        const checkpointId = crypto.randomUUID()
        const document = createDocument()
        let checkpoint: Awaited<ReturnType<typeof encryptJson>>
        try {
          Y.applyUpdate(document, remoteDocument.update)
          applyMarkdownText(document, markdownText(document), content)
          if (markdownText(document).toString() !== content) throw new Error(UNSUPPORTED)
          checkpoint = await encryptJson(key, { format: 'yjs-v1', update: bytesToBase64Url(Y.encodeStateAsUpdate(document)) }, aad)
        } finally { document.destroy() }
        if (base64UrlByteLength(checkpoint.packedCiphertext) > fresh.maxObjectBytes) throw new Error(UNSUPPORTED)
        const resolution = { checkpointId, documentId: remoteDocument.id,
          objectId: preview.objectId, kind: 'note', expectedDocumentSequence: remoteDocument.sequence,
          keyVersion: fresh.keyVersion, ciphertext: checkpoint.packedCiphertext, ciphertextHash: checkpoint.packedCiphertextHash }
        const conflictId = crypto.randomUUID()
        const envelope = await encryptJson(key, {
          version: 1, relativePath: preview.relativePath, localConflictId: preview.id,
          expectedRevision: fresh.remoteRevision, expectedDocumentSequence: remoteDocument.sequence,
        }, aad)
        const createCommandId = crypto.randomUUID()
        const create = { commandId: createCommandId, type: 'create-conflict', conflictId,
          objectId: preview.objectId, kind: 'note', conflictType: 'snapshot-diverged',
          expectedRevision: fresh.remoteRevision, expectedDocumentSequence: remoteDocument.sequence,
          keyVersion: fresh.keyVersion, ciphertext: envelope.packedCiphertext, ciphertextHash: envelope.packedCiphertextHash }
        await database.execute(
          `insert into self_hosted_outbox(command_id,workspace_id,source_change_ids,command_type,payload,state,last_error_code,created_at,updated_at)
           values($1,$2,'[]','create-conflict',$3,'blocked',$4,$5,$5)`,
          [create.commandId, preview.workspaceId, JSON.stringify(create), `editor-resolution:${preview.id}`, Date.now()],
        )
        assertCurrent()
        const created = (await client.pushCommands(preview.workspaceId, [create], fresh.syncEpoch)).results[0]
        if (created?.status !== 'applied' || !created.sequence) throw new Error(created?.code === 'conflict_changed' ? CHANGED : created?.code ?? UNAVAILABLE)
        const resolve = { commandId: crypto.randomUUID(), type: 'resolve-conflict', conflictId,
          expectedCreatedSequence: created.sequence,
          objectResolution: { objectId: preview.objectId, kind: 'note', blobRefs,
            keyVersion: fresh.keyVersion, ciphertext: encrypted.packedCiphertext, ciphertextHash: encrypted.packedCiphertextHash },
          resolution }
        const now = Date.now()
        // Keep the idempotent resolution command durable before sending it.
        // It remains blocked for editor-led recovery if the response is lost.
        await database.execute(
          `insert into self_hosted_outbox(command_id,workspace_id,source_change_ids,command_type,payload,state,last_error_code,created_at,updated_at)
           values($1,$2,'[]','resolve-conflict',$3,'blocked',$4,$5,$5)`,
          [resolve.commandId, preview.workspaceId, JSON.stringify(resolve), `editor-resolution:${preview.id}`, now],
        )
        assertCurrent()
        const accepted = (await client.pushCommands(preview.workspaceId, [resolve], fresh.syncEpoch)).results[0]
        if (accepted?.status !== 'applied' || !accepted.sequence) throw new Error(accepted?.code === 'conflict_changed' ? CHANGED : accepted?.code ?? UNAVAILABLE)
        // User approval covered this exact local snapshot. The path write gate
        // rejects typing or a queued save that arrived during either request.
        assertCurrent()
        await writeResolvedSelfHostedNoteSnapshot({
          workspaceId: preview.workspaceId, objectId: preview.objectId, relativePath: preview.relativePath,
          expectedContent: preview.localFileContent, content, assertCurrent,
        })
        // Do not call isCurrent after installing our own editor content.
        const revision = (BigInt(fresh.remoteRevision) + BigInt(1)).toString()
        const hash = await invoke<string>('self_hosted_sha256', { value: content })
        const statements: RecordStatement[] = [
          { sql: `insert or replace into self_hosted_revisions(workspace_id,object_id,revision,sequence,content_hash,snapshot,created_at)
              values($1,$2,$3,$4,$5,$6,$7)`, values: [preview.workspaceId, preview.objectId, revision, accepted.sequence, hash, content, now] },
          { sql: `update self_hosted_object_mappings set content_hash=$1,blob_refs=$2,updated_at=$3 where workspace_id=$4 and object_id=$5`,
            values: [hash, JSON.stringify(blobRefs), now, preview.workspaceId, preview.objectId] },
          { sql: "update self_hosted_conflicts set state='resolved',resolved_at=$1 where id=$2 and workspace_id=$3 and state='unresolved'",
            values: [now, preview.id, preview.workspaceId], expectedRows: 1 },
          { sql: "update self_hosted_outbox set state='sent',last_error_code=null,updated_at=$1 where command_id=$2", values: [now, resolve.commandId] },
          { sql: "update self_hosted_outbox set state='superseded',last_error_code='editor-conflict-resolved',updated_at=$1 where workspace_id=$2 and state='blocked' and last_error_code=$3",
            values: [now, preview.workspaceId, `editor-resolution:${preview.id}`] },
        ]
        for (const command of retired) {
          statements.push({ sql: "update self_hosted_outbox set state='superseded',last_error_code='editor-conflict-resolved',updated_at=$1 where command_id=$2 and workspace_id=$3",
            values: [now, command.commandId, preview.workspaceId] })
          for (const id of JSON.parse(command.sourceIds) as number[]) statements.push({
            sql: "update self_hosted_local_changes set state='superseded',updated_at=$1 where id=$2 and state='queued'", values: [now, id],
          })
        }
        statements.push({
          sql: `insert or replace into self_hosted_yjs_updates(workspace_id,document_id,document_sequence,object_id,key_version,event_type,update_id,payload,applied,created_at)
            values($1,$2,$3,$4,$5,'checkpoint',$6,$7,1,$8)`,
          values: [preview.workspaceId, remoteDocument.id, (BigInt(remoteDocument.sequence) + BigInt(1)).toString(),
            preview.objectId, fresh.keyVersion, checkpointId, checkpoint.packedCiphertext, now],
        })
        await executeRecordTransaction(statements)
        emitter.emit('self-hosted-conflict-resolved', { workspaceRoot: preview.localRoot, path: preview.relativePath })
      })
    } catch (error) {
      // A report holds no replacement content. Close it idempotently even if
      // the replacement response was lost; keep its durable task on failure.
      await closeResolutionReports(preview).catch(cleanupError => {
        console.warn('[self-hosted-sync] Conflict report cleanup remains pending', cleanupError)
      })
      throw error
    } finally {
      resume()
      emitter.emit('self-hosted-note-collaboration-reset', { workspaceRoot: preview.localRoot, path: preview.relativePath })
      emitter.emit('self-hosted-conflicts-changed', undefined)
    }
  })
}
