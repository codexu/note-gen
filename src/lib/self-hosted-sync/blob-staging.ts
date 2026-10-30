import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, readFile, readTextFile, remove, rename, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'

export interface AssetUploadIdentity {
  profileId: string
  workspaceId: string
  syncEpoch: string
  localRoot: string
  relativePath: string
  keyVersion: number
  plaintextHash: string
}

interface StagedAsset {
  version: 1
  identity: AssetUploadIdentity
  dataFile: string
  ciphertextHash: string
  size: number
  createdAt: number
}

class StagingCorruptionError extends Error {}
const operations = new Map<string, Promise<unknown>>()
const IDENTIFIER = /^[A-Za-z0-9_-]{43}$/
const UNIQUE_FILE = /^[a-f0-9-]{36}$/

/** Upload and release share one queue, so another record cannot delete an
 * attachment's staging file while a second upload is reusing it. */
async function serialized<T>(stagingId: string, action: () => Promise<T>): Promise<T> {
  const previous = operations.get(stagingId) ?? Promise.resolve()
  const operation = previous.catch(() => undefined).then(action)
  operations.set(stagingId, operation)
  try { return await operation }
  finally { if (operations.get(stagingId) === operation) operations.delete(stagingId) }
}

/** Only ciphertext reaches disk. The immutable manifest is written under a
 * temporary unique name and atomically published before any upload starts. */
export async function withAssetUploadStaging<T>(
  identity: AssetUploadIdentity,
  encrypt: () => Promise<Uint8Array>,
  upload: (stage: { stagingId: string; ciphertext: Uint8Array; ciphertextHash: string }) => Promise<T>,
): Promise<T> {
  const stagingId = await digest(new TextEncoder().encode(JSON.stringify(identity)))
  return serialized(stagingId, async () => {
    const root = await stagingRoot()
    await mkdir(root, { recursive: true })
    await cleanCompletedStages(root)
    let staged = await loadValidStage(root, stagingId, identity)
    if (!staged) {
      const ciphertext = await encrypt()
      const unique = crypto.randomUUID()
      const dataFile = `${unique}.bin`
      await writeFile(await join(root, dataFile), ciphertext, { createNew: true })
      const manifest: StagedAsset = {
        version: 1, identity, dataFile, ciphertextHash: await digest(ciphertext),
        size: ciphertext.byteLength, createdAt: Date.now(),
      }
      const temporary = await join(root, `${stagingId}.${unique}.tmp`)
      await writeTextFile(temporary, JSON.stringify(manifest), { createNew: true })
      // The destination is unique. No platform needs to remove or overwrite an
      // existing manifest, and an interrupted write cannot publish partial JSON.
      await rename(temporary, await join(root, `${stagingId}.${unique}.json`))
      staged = await loadValidStage(root, stagingId, identity)
      if (!staged) throw new Error('blob_staging_publish_failed')
    }
    const result = await upload({ stagingId, ciphertext: staged.ciphertext, ciphertextHash: staged.manifest.ciphertextHash })
    await writeTextFile(await join(root, `${stagingId}.complete`), String(Date.now()))
    return result
  })
}

/** Release only after the owning outbox command is durable. No server blob,
 * upload session or outbox row is deleted here. */
export async function removeAssetUploadStaging(stagingId: string) {
  if (!IDENTIFIER.test(stagingId)) throw new Error('blob_staging_id_invalid')
  return serialized(stagingId, async () => {
    const root = await stagingRoot()
    const dataFiles = new Set<string>()
    for (const path of await manifestPaths(root, stagingId)) {
      try {
        const manifest = await readManifest(path)
        dataFiles.add(manifest.dataFile)
        await remove(path)
      } catch (error) {
        if (!(error instanceof StagingCorruptionError)) throw error
        await quarantineManifest(path, stagingId)
      }
    }
    for (const dataFile of dataFiles) {
      const path = await join(root, dataFile)
      if (await exists(path)) await remove(path)
    }
    const marker = await join(root, `${stagingId}.complete`)
    if (await exists(marker)) await remove(marker)
  })
}

async function loadValidStage(root: string, stagingId: string, identity: AssetUploadIdentity) {
  const candidates: Array<{ path: string; manifest: StagedAsset }> = []
  for (const path of await manifestPaths(root, stagingId)) {
    try {
      const manifest = await readManifest(path)
      if (JSON.stringify(manifest.identity) !== JSON.stringify(identity)) throw new StagingCorruptionError('blob_staging_identity_mismatch')
      candidates.push({ path, manifest })
    } catch (error) {
      if (!(error instanceof StagingCorruptionError)) throw error
      await quarantineManifest(path, stagingId)
    }
  }
  // Prefer the previously published legacy manifest. Otherwise the oldest
  // complete immutable candidate is stable across retries and app restarts.
  const legacy = await join(root, `${stagingId}.json`)
  candidates.sort((left, right) => Number(right.path === legacy) - Number(left.path === legacy)
    || left.manifest.createdAt - right.manifest.createdAt || left.path.localeCompare(right.path))
  for (const { path, manifest } of candidates) {
    const dataPath = await join(root, manifest.dataFile)
    if (!await exists(dataPath)) { await quarantineManifest(path, stagingId); continue }
    const ciphertext = await readFile(dataPath)
    if (ciphertext.byteLength !== manifest.size || await digest(ciphertext) !== manifest.ciphertextHash) {
      await quarantineManifest(path, stagingId)
      continue
    }
    return { manifest, ciphertext }
  }
  return null
}

async function manifestPaths(root: string, stagingId: string) {
  if (!await exists(root)) return []
  const paths: string[] = []
  for (const entry of await readDir(root)) {
    if (!entry.isFile) continue
    const name = entry.name
    const suffix = name.startsWith(`${stagingId}.`) && name.endsWith('.json')
      ? name.slice(stagingId.length + 1, -'.json'.length) : ''
    if (name === `${stagingId}.json` || UNIQUE_FILE.test(suffix)) paths.push(await join(root, name))
  }
  return paths
}

async function readManifest(path: string): Promise<StagedAsset> {
  const text = await readTextFile(path)
  let parsed: unknown
  try { parsed = JSON.parse(text) as unknown }
  catch { throw new StagingCorruptionError('blob_staging_manifest_invalid') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new StagingCorruptionError('blob_staging_manifest_invalid')
  const value = parsed as Partial<StagedAsset>
  const identity = value.identity
  if (value.version !== 1 || !identity || typeof identity !== 'object'
    || !['profileId', 'workspaceId', 'syncEpoch', 'localRoot', 'relativePath', 'plaintextHash']
      .every(key => typeof identity[key as keyof AssetUploadIdentity] === 'string')
    || !Number.isSafeInteger(identity.keyVersion) || identity.keyVersion < 1 || !IDENTIFIER.test(identity.plaintextHash)
    || typeof value.dataFile !== 'string' || !/^[a-f0-9-]{36}\.bin$/.test(value.dataFile)
    || typeof value.ciphertextHash !== 'string' || !IDENTIFIER.test(value.ciphertextHash)
    || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 0
    || typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt)) {
    throw new StagingCorruptionError('blob_staging_manifest_invalid')
  }
  return value as StagedAsset
}

async function quarantineManifest(path: string, stagingId: string) {
  // Retain the invalid manifest and all ciphertext for diagnosis/recovery. A
  // valid alternative is reused; only an unverifiable cache is regenerated.
  await rename(path, `${path}.corrupt-${crypto.randomUUID()}`)
  console.warn('[self-hosted-sync] Corrupt upload staging quarantined', { stagingId })
}

async function cleanCompletedStages(root: string) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60_000
  for (const entry of (await readDir(root)).filter(value => value.isFile && value.name.endsWith('.complete')).slice(0, 100)) {
    const stagingId = entry.name.slice(0, -'.complete'.length)
    if (!IDENTIFIER.test(stagingId) || operations.has(stagingId)) continue
    try {
      const timestamp = Number(await readTextFile(await join(root, entry.name)))
      if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < cutoff) await removeAssetUploadStaging(stagingId)
    } catch {
      console.warn('[self-hosted-sync] Completed upload staging cleanup deferred', { stagingId })
    }
  }
}

function stagingRoot() { return appDataDir().then(root => join(root, 'self-hosted-upload-staging')) }

async function digest(bytes: Uint8Array) {
  const buffer = new Uint8Array(bytes.byteLength)
  buffer.set(bytes)
  const hashed = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer.buffer))
  return btoa(String.fromCharCode(...hashed)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
