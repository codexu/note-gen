import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { readFile } from '@tauri-apps/plugin-fs'
import { getDb } from '@/db'
import { syncStaleError } from '@/lib/sync/sync-stale-error'
import { stableSyncValue, type SwitchOperationProgress, type SwitchStrategy } from '@/lib/sync/platform-switch-plan'
import { base64UrlByteLength, hashBytes, uploadAsset, removeAssetUploadStaging } from './blob'
import { personalAssetPaths, preparePersonalAssetsUpload, readPersonalAsset } from './personal-assets'
import { encryptJson, loadWorkspaceKey, objectAssociatedData } from './crypto'
import { authenticatedClient } from './profile'
import { STRUCTURED_DOMAINS, structuredPayload } from './outbox'
import { ensureDefaultLibraryForCurrentWorkspace, bindLibrary, ensureManagedWorkspaceKeys } from './workspaces'
import { overwriteSwitchDocument, readSwitchDocument } from './switch-document'
import { replaceSelfHostedLocalSnapshot } from './switch-apply'
import {
  getSelfHostedSwitchSnapshot, inspectSelfHostedSwitch,
  type SelfHostedSwitchLocalObject, type SelfHostedSwitchPreview, type SelfHostedSwitchSnapshot, type SelfHostedSwitchWorkspace,
} from './switch-preview'
import type { SyncBootstrapPage, WorkspaceCapability } from './protocol'

type RemoteObject = SelfHostedSwitchWorkspace['objects'][number]
const stale = () => syncStaleError({ stage: 'apply', path: 'selfHosted', check: 'version' })
const kindFor = (domain: string) => domain === 'file' ? 'note' : domain
const priority = (domain: string) => domain === 'folder' ? 0 : ['tag', 'conversation'].includes(domain) ? 1
  : ['file', 'mark', 'message', 'canvas'].includes(domain) ? 2 : domain === 'asset' ? 3 : 4

export function validateSelfHostedSwitchStrategy(preview: SelfHostedSwitchPreview, strategy: SwitchStrategy) {
  if (strategy === 'merge') return
  const snapshot = getSelfHostedSwitchSnapshot(preview)
  const enabled = new Set(snapshot.enabledDomains)
  if (((enabled.has('mark') || enabled.has('message')) && !enabled.has('tag'))
    || (enabled.has('message') && !enabled.has('conversation'))) throw new Error('SELF_HOSTED_SWITCH_DEPENDENCY_REQUIRED')
  if (!snapshot.workspaces.some(workspace => workspace.workspaceType === 'account-data')) throw new Error('SELF_HOSTED_PREVIEW_CONNECTION_REQUIRED')
  const required: WorkspaceCapability[] = ['content.create', 'content.update', 'content.delete']
  if (strategy === 'local' && snapshot.workspaces.some(({ workspace }) =>
    !required.every(capability => workspace.capabilities.includes(capability)))) {
    throw new Error('SELF_HOSTED_SWITCH_WRITE_REQUIRED')
  }
}

/** Apply the approved direction while the normal runtime is stopped. */
export async function executeSelfHostedSwitch(
  preview: SelfHostedSwitchPreview,
  strategy: Exclude<SwitchStrategy, 'merge'>,
  assertActive: () => void,
  onProgress: (progress: SwitchOperationProgress) => void,
) {
  validateSelfHostedSwitchStrategy(preview, strategy)
  const snapshot = getSelfHostedSwitchSnapshot(preview)
  if (strategy === 'local') {
    for (const local of snapshot.localObjects.filter(item => item.domain === 'mark' || item.domain === 'message')) {
      assertActive()
      if (snapshot.attachmentsEnabled) {
        for (const path of personalAssetPaths(local.payload)) {
          if (!await readPersonalAsset(path)) throw new Error('SELF_HOSTED_PERSONAL_ASSET_MISSING')
        }
      } else if (local.workspaceId && local.objectId) {
        const prepared = await preparePersonalAssetsUpload({ profileId: snapshot.profileId, workspaceId: local.workspaceId,
          syncEpoch: snapshot.syncEpoch, objectId: local.objectId, keyVersion: 1, payload: local.payload, enabled: false })
        if (prepared.deferred) throw new Error('SELF_HOSTED_PERSONAL_ATTACHMENTS_REQUIRED')
      }
    }
  }
  const { client } = await authenticatedClient(snapshot.profileId)
  assertActive()
  const { getPendingWorkspacePathMoves, hasPendingSelfHostedWorkspacePathMoves } = await import('@/lib/sync/workspace-path-moves')
  if ((await getPendingWorkspacePathMoves()).length
    || await hasPendingSelfHostedWorkspacePathMoves(snapshot.workspaces.map(item => item.workspaceId), snapshot.profileId)) {
    throw new Error('SELF_HOSTED_SWITCH_PATH_MOVES_PENDING')
  }
  // Bind without starting bootstrap/pull. A first-time library may only be
  // created after the approved local backup and durable recovery marker exist.
  const workspaceId = await ensureDefaultLibraryForCurrentWorkspace(snapshot.profileId, '我的工作区')
  if (!workspaceId) throw new Error('SELF_HOSTED_PREVIEW_LIBRARY_REQUIRED')
  const workspaces = await client.workspaces()
  for (const library of preview.libraries) {
    const id = library.workspaceId ?? workspaceId
    if (!snapshot.workspaces.some(item => item.workspaceId === id)) {
      const workspace = workspaces.find(item => item.id === id)
      if (!workspace) throw stale()
      // A library created concurrently after review must be reviewed again.
      const session = await client.syncSession(id, '0', snapshot.syncEpoch)
      if (session.latestSequence !== '0') throw stale()
      snapshot.workspaces.push({ workspace, workspaceId: id, workspaceType: 'library', localRoot: library.localRoot, sequence: '0', objects: [] })
    }
    const database = await getDb()
    const bindings = await database.select<Array<{ root: string | null }>>(
      'select local_root as root from self_hosted_workspace_bindings where workspace_id = $1', [id],
    )
    if (bindings[0]?.root !== library.localRoot) await bindLibrary(snapshot.profileId, id, library.localRoot, false)
    for (const local of snapshot.localObjects) if (local.localRoot === library.localRoot && local.workspaceId === null) local.workspaceId = id
  }
  for (const workspace of snapshot.workspaces) {
    assertActive()
    const session = await client.syncSession(workspace.workspaceId, '0', snapshot.syncEpoch)
    if (session.latestSequence !== workspace.sequence) throw stale()
    await ensureManagedWorkspaceKeys(snapshot.profileId, workspace.workspaceId, session.keyVersions.map(key => key.keyVersion))
  }
  const beforeApply = async () => {
    await assertLocalPersonalSnapshot(snapshot, assertActive)
    for (const workspace of snapshot.workspaces) {
      assertActive()
      if ((await client.syncSession(workspace.workspaceId, workspace.sequence, snapshot.syncEpoch)).latestSequence !== workspace.sequence) throw stale()
    }
  }
  if (strategy === 'remote') {
    await replaceSelfHostedLocalSnapshot({ ...snapshot,
      localFiles: snapshot.localObjects.filter(item => item.localRoot && item.domain !== 'folder').map(item => ({
        workspaceId: item.workspaceId!, relativePath: item.localKey, hash: item.hash,
      })), assertActive, onProgress, beforeApply })
    onProgress({ phase: 'verify', source: 'local', kind: 'item', current: 0, total: 0 })
    // Do not acknowledge an unreviewed concurrent server update as this switch.
    for (const workspace of snapshot.workspaces) {
      assertActive()
      if ((await client.syncSession(workspace.workspaceId, workspace.sequence, snapshot.syncEpoch)).latestSequence !== workspace.sequence) throw stale()
    }
    const verified = await inspectSelfHostedSwitch(assertActive, onProgress, 'verify')
    const mismatches = verified.modules.filter(row => {
      if (row.id === 'settings') return false
      const protectedLocal = row.id === 'tags' || (row.id === 'conversations' && !snapshot.enabledDomains.includes('message'))
      return row.remoteOnly || row.changed || row.deleted || (!protectedLocal && row.localOnly)
    })
    if (mismatches.length) {
      reportResultMismatch('remote', mismatches)
      throw new Error('SELF_HOSTED_SWITCH_RESULT_MISMATCH')
    }
    const verifiedSnapshot = getSelfHostedSwitchSnapshot(verified)
    if (snapshot.workspaces.some(workspace => verifiedSnapshot.workspaces.find(item => item.workspaceId === workspace.workspaceId)?.sequence !== workspace.sequence)) throw stale()
  } else {
    await beforeApply()
    await replaceRemoteSnapshot(snapshot, assertActive, onProgress)
  }
}

function reportResultMismatch(strategy: SwitchStrategy, modules: SelfHostedSwitchPreview['modules']) {
  // Keep diagnostics useful without logging note names or personal payloads.
  console.warn('[self-hosted-sync] Platform switch result did not match the selected snapshot', {
    strategy, modules: modules.map(({ id, localOnly, remoteOnly, changed, deleted }) => ({ id, localOnly, remoteOnly, changed, deleted })),
  })
}

async function assertLocalPersonalSnapshot(snapshot: SelfHostedSwitchSnapshot, assertActive: () => void) {
  const database = await getDb()
  const workspace = snapshot.workspaces.find(item => item.workspaceType === 'account-data')!
  for (const asset of snapshot.personalAssets) {
    assertActive()
    const bytes = await readPersonalAsset(asset.path)
    if (!bytes || await hashBytes(bytes) !== asset.hash) throw stale()
  }
  for (const domain of snapshot.enabledDomains) {
    const expected = snapshot.localObjects.filter(item => !item.localRoot && item.domain === domain)
    let keys = ['all']
    if (domain !== 'setting') {
      const config = STRUCTURED_DOMAINS[domain]
      const rows = await database.select<Array<Record<string, unknown>>>(`select * from ${config.table}`)
      keys = rows.filter(row => !(domain === 'mark' && row.deleted === 1) && !(domain === 'canvas' && row.deletedAt != null))
        .map(row => String(row[config.keyColumn] ?? row.id))
    }
    if (keys.length !== expected.length) throw stale()
    for (const key of keys) {
      assertActive()
      const original = expected.find(item => item.localKey === key)
      if (!original || stableSyncValue(await structuredPayload(workspace.workspaceId, domain, key, true)) !== stableSyncValue(original.payload)) throw stale()
    }
  }
}

async function portable(path: string) {
  return invoke<{ normalized: string; caseFolded: string }>('self_hosted_portable_path', { relativePath: path })
}

async function replaceRemoteSnapshot(
  snapshot: SelfHostedSwitchSnapshot,
  assertActive: () => void,
  onProgress: (progress: SwitchOperationProgress) => void,
) {
  const { client } = await authenticatedClient(snapshot.profileId)
  const database = await getDb()
  let completed = 0
  for (const workspace of snapshot.workspaces) {
    assertActive()
    const id = workspace.workspaceId
    const session = await client.syncSession(id, '0', snapshot.syncEpoch)
    if (session.latestSequence !== workspace.sequence) throw stale()
    if (!session.workspace.capabilities.includes('content.create') || !session.workspace.capabilities.includes('content.update')
      || !session.workspace.capabilities.includes('content.delete')) throw new Error('SELF_HOSTED_SWITCH_WRITE_REQUIRED')
    const keyVersion = Math.max(...session.keyVersions.map(key => key.keyVersion))
    const key = await loadWorkspaceKey(id, keyVersion)
    let expectedSequence = workspace.sequence
    const acceptSequence = (sequence: string) => {
      if (BigInt(sequence) !== BigInt(expectedSequence) + BigInt(1)) throw stale()
      expectedSequence = sequence
    }
    const assertRemote = async () => {
      assertActive()
      if ((await client.syncSession(id, expectedSequence, snapshot.syncEpoch)).latestSequence !== expectedSequence) throw stale()
    }
    const push = async (command: Record<string, unknown>) => {
      await assertRemote()
      const response = await client.pushCommands(id, [command], snapshot.syncEpoch)
      const result = response.results[0]
      if (response.syncEpoch !== snapshot.syncEpoch || response.results.length !== 1 || result?.commandId !== command.commandId
        || result.status !== 'applied' || result.conflictId || !result.sequence || !result.revision) throw stale()
      acceptSequence(result.sequence)
      return result
    }
    const locals = snapshot.localObjects.filter(item => item.workspaceId === id)
    const byPath = new Map<string, RemoteObject>()
    for (const remote of workspace.objects) {
      if (workspace.workspaceType !== 'library') continue
      const path = await portable(String(remote.payload.relativePath ?? ''))
      const previous = byPath.get(path.caseFolded)
      if (!previous || previous.object.deletedAt) byPath.set(path.caseFolded, remote)
    }
    const claimed = new Set<string>()
    const remoteFor = new Map<SelfHostedSwitchLocalObject, RemoteObject>()
    for (const local of locals) {
      const remote = workspace.workspaceType === 'library' ? byPath.get((await portable(local.localKey)).caseFolded)
        : workspace.objects.find(item => item.object.objectId === local.objectId)
      if (remote && remote.object.kind === kindFor(local.domain)) {
        local.objectId = remote.object.objectId
        remoteFor.set(local, remote)
      } else local.objectId ??= crypto.randomUUID()
      claimed.add(local.objectId!)
    }
    locals.sort((a, b) => priority(a.domain) - priority(b.domain) || a.localKey.split('/').length - b.localKey.split('/').length)
    const accepted: Array<{ local: SelfHostedSwitchLocalObject; object: SyncBootstrapPage['objects'][number]; sequence: string }> = []
    for (const local of locals) {
      assertActive()
      const remote = remoteFor.get(local)
      const kind = (local.domain === 'file' ? 'note' : local.domain) as SyncBootstrapPage['objects'][number]['kind']
      onProgress({ phase: 'apply', source: 'remote', kind: 'file', path: local.localKey, current: completed++, total: snapshot.localObjects.length })
      let payload = local.payload
      let blobRefs: string[] = []
      let personalStagingIds: string[] = []
      if (!local.localRoot && (local.domain === 'mark' || local.domain === 'message')) {
        const prepared = await preparePersonalAssetsUpload({ profileId: snapshot.profileId, workspaceId: id,
          syncEpoch: snapshot.syncEpoch, objectId: local.objectId!, keyVersion, payload, enabled: snapshot.attachmentsEnabled })
        if (prepared.deferred) throw new Error('SELF_HOSTED_PERSONAL_ATTACHMENTS_REQUIRED')
        payload = prepared.payload
        blobRefs = prepared.blobRefs
        personalStagingIds = prepared.stagingIds
      }
      if (local.localRoot && local.domain !== 'folder') {
        const bytes = await readFile(await join(local.localRoot, local.localKey))
        if (await hashBytes(bytes) !== local.hash) throw stale()
        if (local.domain === 'file') {
          const content = new TextDecoder().decode(bytes)
          if (await hashBytes(new TextEncoder().encode(content)) !== local.hash) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
          payload = { ...payload, content }
        }
      }
      const document = remote ? await readSwitchDocument(client, id, { ...remote.object, deletedAt: null }, snapshot.syncEpoch,
        version => loadWorkspaceKey(id, version), assertActive) : null
      try {
        let encrypted = await encryptJson(key, payload, objectAssociatedData(id, local.objectId!, kind))
        if (local.domain === 'asset' || (local.domain === 'file' && base64UrlByteLength(encrypted.packedCiphertext) > session.limits.maxObjectBytes)) {
          const blob = await uploadAsset({ profileId: snapshot.profileId, workspaceId: id, syncEpoch: snapshot.syncEpoch,
            localRoot: local.localRoot!, relativePath: local.localKey, keyVersion })
          if (blob.plaintextHash !== local.hash) throw stale()
          blobRefs = [blob.blobId]
          encrypted = await encryptJson(key, { version: 1, domain: local.domain, relativePath: local.localKey, ...blob }, objectAssociatedData(id, local.objectId!, kind))
        }
        const parentPath = local.localKey.includes('/') ? local.localKey.slice(0, local.localKey.lastIndexOf('/')) : ''
        const parentObjectId = local.localRoot && parentPath ? locals.find(item => item.domain === 'folder' && item.localKey === parentPath)?.objectId ?? null : null
        const result = await push({ commandId: crypto.randomUUID(), type: 'upsert-object', objectId: local.objectId,
          kind, parentObjectId, nameCiphertext: null, nameBlindIndex: null, baseRevision: remote?.object.currentRevision ?? null,
          blobRefs, keyVersion, ciphertext: encrypted.packedCiphertext, ciphertextHash: encrypted.packedCiphertextHash })
        const object: SyncBootstrapPage['objects'][number] = { objectId: local.objectId!, kind, parentObjectId, nameCiphertext: null,
          currentRevision: result.revision!, ciphertext: encrypted.packedCiphertext, ciphertextHash: encrypted.packedCiphertextHash,
          keyVersion, blobRefs, deletedAt: null, document: remote?.object.document ?? null }
        if (document && remote) {
          await assertRemote()
          const sequence = await overwriteSwitchDocument({ client, workspaceId: id, object: remote.object, syncEpoch: snapshot.syncEpoch,
            state: document, payload, keyVersion, key, materializedRevision: result.revision!, assertActive, onApplied: acceptSequence })
          object.document = { ...remote.object.document!, latestDocumentSequence: sequence }
        }
        local.payload = payload
        accepted.push({ local, object, sequence: expectedSequence })
        for (const stagingId of personalStagingIds) await removeAssetUploadStaging(stagingId).catch(() => undefined)
      } finally { document?.document.destroy() }
    }
    const removed = workspace.objects.filter(item => !item.object.deletedAt && !claimed.has(item.object.objectId))
      .sort((a, b) => Number(a.object.kind === 'folder') - Number(b.object.kind === 'folder')
        || Number(a.object.kind === 'asset') - Number(b.object.kind === 'asset')
        || String(b.payload.relativePath ?? '').split('/').length - String(a.payload.relativePath ?? '').split('/').length)
    for (const remote of removed) {
      assertActive()
      const object = remote.object
      const encrypted = await encryptJson(key, { ...remote.payload, deleted: true }, objectAssociatedData(id, object.objectId, object.kind))
      await push({ commandId: crypto.randomUUID(), type: 'delete-object', objectId: object.objectId, kind: object.kind,
        baseRevision: object.currentRevision, expectedDocumentSequence: object.document?.latestDocumentSequence ?? '0', blobRefs: object.blobRefs,
        conflictId: crypto.randomUUID(), conflictCiphertext: encrypted.packedCiphertext, conflictCiphertextHash: encrypted.packedCiphertextHash,
        keyVersion, ciphertext: encrypted.packedCiphertext, ciphertextHash: encrypted.packedCiphertextHash })
    }
    await assertRemote()
    // Accept only this workspace's chosen domains; old queued edits must never
    // replay over the authoritative replacement after the runtime restarts.
    const domains = workspace.workspaceType === 'library' ? ['file', 'asset', 'folder'] : snapshot.enabledDomains
    await database.execute("update self_hosted_local_changes set state = 'superseded', updated_at = $1 where (workspace_id = $2 or (workspace_id is null and $3 = 'account-data')) and domain in (select value from json_each($4))", [Date.now(), id, workspace.workspaceType, JSON.stringify(domains)])
    const affectedIds = JSON.stringify([...new Set([...claimed, ...workspace.objects.map(item => item.object.objectId)])])
    await database.execute("delete from self_hosted_outbox where workspace_id = $1 and (coalesce(json_extract(payload, '$.kind'),json_extract(payload, '$.objectResolution.kind'),json_extract(payload, '$.resolution.kind')) in (select value from json_each($2)) or $3 = 'library' or json_extract(payload, '$.conflictId') in (select id from self_hosted_conflicts where workspace_id = $1 and object_id in (select value from json_each($4))))", [id, JSON.stringify(domains), workspace.workspaceType, affectedIds])
    await database.execute('delete from self_hosted_inbox where workspace_id = $1', [id])
    await database.execute("delete from self_hosted_yjs_updates where workspace_id = $1 and (object_id in (select value from json_each($2)) or $3 = 'library')", [id, affectedIds, workspace.workspaceType])
    await database.execute("delete from self_hosted_revisions where workspace_id = $1 and (object_id in (select object_id from self_hosted_object_mappings where workspace_id = $1 and kind in (select value from json_each($2))) or object_id in (select value from json_each($3)) or $4 = 'library')", [id, JSON.stringify(domains), affectedIds, workspace.workspaceType])
    await database.execute("delete from self_hosted_remote_objects where workspace_id = $1 and (kind in (select value from json_each($2)) or $3 = 'library')", [id, JSON.stringify(domains), workspace.workspaceType])
    await database.execute("delete from self_hosted_object_mappings where workspace_id = $1 and (kind in (select value from json_each($2)) or $3 = 'library')", [id, JSON.stringify(domains), workspace.workspaceType])
    for (const { local, object, sequence } of accepted) {
      const path = local.localRoot ? await portable(local.localKey) : null
      const content = local.domain === 'file' ? String(local.payload.content ?? '') : null
      const contentHash = local.domain === 'folder' ? null
        : content !== null ? await invoke<string>('self_hosted_sha256', { value: content }) : local.hash
      await database.execute(`insert into self_hosted_object_mappings(workspace_id, object_id, kind, local_identity, relative_path, path_casefold, content_hash, blob_refs, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, object.objectId, object.kind, `${local.domain}:${local.localKey}`, path?.normalized ?? null, path?.caseFolded ?? null, contentHash, JSON.stringify(object.blobRefs), Date.now()])
      await database.execute(`insert or replace into self_hosted_revisions(workspace_id, object_id, revision, sequence, content_hash, snapshot, created_at) values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, object.objectId, object.currentRevision, sequence, object.ciphertextHash, content, Date.now()])
      if (!local.localRoot) await database.execute(`insert or replace into self_hosted_remote_objects(workspace_id, object_id, kind, revision, payload, updated_at) values ($1,$2,$3,$4,$5,$6)`,
        [id, object.objectId, object.kind, object.currentRevision, JSON.stringify(local.payload), Date.now()])
    }
    await client.acknowledge(id, expectedSequence, snapshot.syncEpoch)
    await database.execute(`insert into self_hosted_cursors(workspace_id,pulled_sequence,applied_sequence,acknowledged_sequence,updated_at) values ($1,$2,$2,$2,$3) on conflict(workspace_id) do update set pulled_sequence=$2,applied_sequence=$2,acknowledged_sequence=$2,updated_at=$3`, [id, expectedSequence, Date.now()])
    await database.execute("update self_hosted_workspace_bindings set binding_state='bound',sync_epoch=$1,updated_at=$2 where workspace_id=$3", [snapshot.syncEpoch, Date.now(), id])
    workspace.sequence = expectedSequence
  }
  assertActive()
  onProgress({ phase: 'verify', source: 'remote', kind: 'item', current: 0, total: 0 })
  const verified = await inspectSelfHostedSwitch(assertActive, onProgress, 'verify')
  const mismatches = verified.modules.filter(row => row.localOnly || row.remoteOnly || row.changed || row.deleted)
  if (mismatches.length) {
    reportResultMismatch('local', mismatches)
    throw new Error('SELF_HOSTED_SWITCH_RESULT_MISMATCH')
  }
  const verifiedSnapshot = getSelfHostedSwitchSnapshot(verified)
  if (snapshot.workspaces.some(workspace => verifiedSnapshot.workspaces.find(item => item.workspaceId === workspace.workspaceId)?.sequence !== workspace.sequence)) throw stale()
}
