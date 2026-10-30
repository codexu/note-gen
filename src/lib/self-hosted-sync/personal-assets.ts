import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, lstat, readFile } from '@tauri-apps/plugin-fs'
import { getDb } from '@/db'
import { resolveConversationAssetPath } from '@/lib/conversation-assets'
import { assetAssociatedData, bytesToBase64Url, downloadAsset, hashBytes, uploadAssetBytes } from './blob'
import { isPersonalSyncKindEnabled } from './domains'

export interface PersonalAsset {
  path: string
  blobId: string
  plaintextHash: string
  size: number
  associatedData: string
  keyVersion: number
}
export interface PreparedPersonalAsset {
  workspaceId: string
  path: string
  hash: string
  bytes: Uint8Array
  observedLocalHash: string | null
}
const digestPattern = /^[A-Za-z0-9_-]{43}$/
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
export const personalAssetIdentity = (path: string) => path.normalize('NFC').toLowerCase()

export function isManagedPersonalAssetPath(path: string) {
  return /^(image|screenshot|recordings|link-assets|conversation-assets)\//.test(path)
    && !/[\\:\u0000]/.test(path) && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/** Only files managed by NoteGen are transferable; external file attachments
 * retain their existing metadata-only behavior. */
export function personalAssetPaths(payload: Record<string, unknown>): string[] {
  const value = record(payload.value)
  const paths: string[] = []
  if (payload.domain === 'mark') {
    const url = typeof value.url === 'string' ? value.url : ''
    if (url && !/^https?:\/\//i.test(url)) {
      const normalized = url.replaceAll('\\', '/').replace(/^\/+/, '')
      const filename = normalized.split('/').at(-1)
      if (filename && (value.type === 'scan' || value.type === 'image')) {
        paths.push(`${value.type === 'scan' ? 'screenshot' : 'image'}/${filename}`)
      } else if (value.type === 'recording') paths.push(normalized)
    }
    if (value.type === 'link' && typeof value.content === 'string') {
      paths.push(...(value.content.match(/link-assets\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+/g) ?? []))
    }
  } else if (payload.domain === 'message') {
    const candidates: unknown[] = [value.image]
    if (typeof value.images === 'string' && value.images) {
      const images: unknown = JSON.parse(value.images)
      if (!Array.isArray(images)) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
      candidates.push(...images)
    } else if (Array.isArray(value.images)) candidates.push(...value.images)
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const path = resolveConversationAssetPath(candidate)
      if (path) paths.push(path)
    }
  }
  if (paths.some(path => !isManagedPersonalAssetPath(path))) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
  return [...new Set(paths)]
}

export function personalAssetManifest(payload: Record<string, unknown>, workspaceId: string): PersonalAsset[] {
  if (payload.personalAssets === undefined) return []
  if (!Array.isArray(payload.personalAssets)) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
  const referenced = new Set(personalAssetPaths(payload))
  const found = new Set<string>()
  const portableHashes = new Map<string, string>()
  return payload.personalAssets.map(item => {
    const asset = record(item)
    if (typeof asset.path !== 'string' || !referenced.has(asset.path) || found.has(asset.path)
      || typeof asset.blobId !== 'string' || !digestPattern.test(asset.blobId)
      || typeof asset.plaintextHash !== 'string' || !digestPattern.test(asset.plaintextHash)
      || typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size < 0
      || typeof asset.keyVersion !== 'number' || !Number.isSafeInteger(asset.keyVersion) || asset.keyVersion < 1
      || asset.associatedData !== assetAssociatedData(workspaceId, asset.path)) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
    found.add(asset.path)
    const identity = personalAssetIdentity(asset.path)
    if (portableHashes.has(identity) && portableHashes.get(identity) !== asset.plaintextHash) throw new Error('SELF_HOSTED_PERSONAL_ASSET_CONFLICT')
    portableHashes.set(identity, asset.plaintextHash)
    return asset as unknown as PersonalAsset
  })
}

/** Check every segment before reading, so a managed path cannot follow a link
 * into an external directory. Writes use the native atomic writer's equivalent check. */
export async function readPersonalAsset(path: string): Promise<Uint8Array | null> {
  if (!isManagedPersonalAssetPath(path)) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
  const root = await appDataDir()
  const segments = path.split('/')
  for (let index = 1; index <= segments.length; index++) {
    const absolute = await join(root, ...segments.slice(0, index))
    if (!await exists(absolute)) return null
    const info = await lstat(absolute)
    if (info.isSymlink || (index < segments.length ? !info.isDirectory : !info.isFile)) {
      throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
    }
  }
  return readFile(await join(root, path))
}

export async function preparePersonalAssetsUpload(input: {
  profileId: string; workspaceId: string; syncEpoch: string; objectId: string; keyVersion: number
  payload: Record<string, unknown>; enabled: boolean; signal?: AbortSignal
}) {
  const paths = personalAssetPaths(input.payload)
  if (!paths.length) return { payload: input.payload, blobRefs: [] as string[], stagingIds: [] as string[], deferred: false }
  const database = await getDb()
  const cached = await database.select<Array<{ payload: string }>>(
    'select payload from self_hosted_remote_objects where workspace_id = $1 and object_id = $2',
    [input.workspaceId, input.objectId],
  )
  const previous = cached[0] ? personalAssetManifest(record(JSON.parse(cached[0].payload)), input.workspaceId) : []
  if (!input.enabled && paths.some(path => !previous.some(asset => asset.path === path))) {
    return { payload: input.payload, blobRefs: [] as string[], stagingIds: [] as string[], deferred: true }
  }
  const assets: PersonalAsset[] = []
  const stagingIds: string[] = []
  for (const path of paths) {
    input.signal?.throwIfAborted()
    const existing = previous.find(asset => asset.path === path)
    if (!input.enabled) { if (existing) assets.push(existing); continue }
    const bytes = await readPersonalAsset(path)
    if (!bytes) {
      if (existing) { assets.push(existing); continue }
      throw new Error('SELF_HOSTED_PERSONAL_ASSET_MISSING')
    }
    const hash = await hashBytes(bytes)
    if (existing?.plaintextHash === hash && existing.size === bytes.length) { assets.push(existing); continue }
    const uploaded = await uploadAssetBytes({ ...input, localRoot: await appDataDir(), relativePath: path, plaintext: bytes })
    stagingIds.push(uploaded.stagingId)
    assets.push({ path, blobId: uploaded.blobId, plaintextHash: uploaded.plaintextHash, size: uploaded.size,
      associatedData: uploaded.associatedData, keyVersion: input.keyVersion })
  }
  return { payload: { ...input.payload, personalAssets: assets },
    blobRefs: [...new Set(assets.map(asset => asset.blobId))], stagingIds, deferred: false }
}

/** Fetch the complete set before writing an owning row or any attachment. */
export async function preparePersonalAssetDownloads(input: {
  profileId: string; workspaceId: string; payload: Record<string, unknown>; enabled: boolean
  overwrite?: boolean; signal?: AbortSignal
}): Promise<PreparedPersonalAsset[]> {
  if (!input.enabled) return []
  const manifest = personalAssetManifest(input.payload, input.workspaceId)
  const prepared: PreparedPersonalAsset[] = []
  for (const path of personalAssetPaths(input.payload)) {
    input.signal?.throwIfAborted()
    const local = await readPersonalAsset(path)
    const asset = manifest.find(asset => asset.path === path)
    // Legacy objects have no blob manifest. Never install a dangling reference.
    if (!asset) {
      if (!local) throw new Error('SELF_HOSTED_PERSONAL_ASSET_MISSING')
      continue
    }
    if (local && await hashBytes(local) === asset.plaintextHash) continue
    if (local && !input.overwrite) throw new Error('SELF_HOSTED_PERSONAL_ASSET_CONFLICT')
    const downloaded = await downloadAsset({ ...input, blobId: asset.blobId, relativePath: path,
      keyVersion: asset.keyVersion, associatedData: asset.associatedData })
    if (downloaded.hash !== asset.plaintextHash || downloaded.bytes.length !== asset.size) throw new Error('blob_plaintext_hash_mismatch')
    prepared.push({ workspaceId: input.workspaceId, path, hash: downloaded.hash, bytes: downloaded.bytes,
      observedLocalHash: local ? await hashBytes(local) : null })
  }
  return prepared
}

export async function applyPersonalAssetDownloads(assets: PreparedPersonalAsset[], assertActive: () => void = () => {}) {
  const unique = new Map<string, PreparedPersonalAsset>()
  const portableHashes = new Map<string, string>()
  for (const asset of assets) {
    if (unique.has(asset.path) && unique.get(asset.path)!.hash !== asset.hash) throw new Error('SELF_HOSTED_PERSONAL_ASSET_CONFLICT')
    unique.set(asset.path, asset)
    const identity = personalAssetIdentity(asset.path)
    if (portableHashes.has(identity) && portableHashes.get(identity) !== asset.hash) throw new Error('SELF_HOSTED_PERSONAL_ASSET_CONFLICT')
    portableHashes.set(identity, asset.hash)
  }
  const root = await appDataDir()
  for (const asset of unique.values()) {
    assertActive()
    const current = await readPersonalAsset(asset.path)
    const currentHash = current ? await hashBytes(current) : null
    if (currentHash === asset.hash) continue
    if (currentHash !== asset.observedLocalHash) throw new Error('SELF_HOSTED_PERSONAL_ASSET_CONFLICT')
    assertActive()
    await invoke('self_hosted_atomic_write', {
      workspaceId: asset.workspaceId, workspaceRoot: root, relativePath: asset.path,
      contents: bytesToBase64Url(asset.bytes), expectedHash: asset.hash,
    })
  }
}

export async function hydratePersonalAssets(input: Parameters<typeof preparePersonalAssetDownloads>[0]) {
  await applyPersonalAssetDownloads(await preparePersonalAssetDownloads(input))
}

/** Existing records also need manifests after upgrading, even without an edit. */
export async function enqueuePersonalAssetBackfill(workspaceId: string, toggles: Record<string, boolean>) {
  if (toggles.attachments === false) return
  const database = await getDb()
  for (const [domain, table, key, toggle] of [
    ['mark', 'marks', 'coalesce(sourceId, cast(id as text))', 'marks'],
    ['message', 'chats', 'syncId', 'messages'],
  ]) {
    if (toggles[toggle] === false || !isPersonalSyncKindEnabled(domain, toggles)) continue
    const rows = await database.select<Array<Record<string, unknown>>>(
      `select *, ${key} as assetLocalKey from ${table} ${domain === 'mark' ? 'where deleted = 0' : ''}`,
    )
    for (const row of rows) {
      let needsUpload = false
      try {
        const paths = personalAssetPaths({ domain, value: row })
        if (!paths.length) continue
        const cached = await database.select<Array<{ payload: string }>>(`select r.payload from self_hosted_object_mappings m
        join self_hosted_remote_objects r on r.workspace_id = m.workspace_id and r.object_id = m.object_id
        where m.workspace_id = $1 and m.local_identity = $2 and m.deleted_at is null`, [workspaceId, `${domain}:${row.assetLocalKey}`])
        const manifest = cached[0] ? personalAssetManifest(record(JSON.parse(cached[0].payload)), workspaceId) : []
        for (const path of paths) {
          const bytes = await readPersonalAsset(path)
          const existing = manifest.find(asset => asset.path === path)
          if (bytes ? existing?.plaintextHash !== await hashBytes(bytes) : !existing) needsUpload = true
        }
      } catch {
        // The materializer records an owner-specific error/backoff without
        // preventing healthy tags, settings or other records from syncing.
        needsUpload = true
      }
      if (!needsUpload) continue
      await database.execute(`insert into self_hosted_local_changes(workspace_id, domain, local_key, operation, reason, state, created_at, updated_at)
        select $1,$2,$3,'upsert','personal-assets:backfill','pending',$4,$4 where not exists (
          select 1 from self_hosted_local_changes where (workspace_id = $1 or workspace_id is null)
            and domain = $2 and local_key = $3 and state in ('pending','queued'))`,
      [workspaceId, domain, String(row.assetLocalKey), Date.now()])
    }
  }
}
