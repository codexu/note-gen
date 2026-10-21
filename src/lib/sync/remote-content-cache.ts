import { BaseDirectory, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { syncStaleError, withSyncStaleContext } from './sync-stale-error'

const CACHE_ROOT = 'sync-remote-content-cache/v1'
const CACHE_BUDGET = 128 * 1024 * 1024
const MAX_FILE_SIZE = CACHE_BUDGET
const MAX_ENTRIES = 4096
const digestPattern = /^[a-f0-9]{64}$/
let commits: Promise<void> = Promise.resolve()

interface CachedFile {
  version: string
  hash: string
  size: number
  usedAt: number
}

export function normalizeRemoteVersion(version: string | undefined): string | null {
  const value = version?.trim()
  if (!value || /^W\//i.test(value) || value.startsWith('uploaded:')) return null
  return value.replace(/^"(.*)"$/, '$1') || null
}

async function contentHash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

export async function gitBlobVersion(bytes: Uint8Array, length = 40) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const blob = new Uint8Array(header.length + bytes.length)
  blob.set(header)
  blob.set(bytes, header.length)
  const digest = await crypto.subtle.digest(length === 64 ? 'SHA-256' : 'SHA-1', blob.buffer)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

function isCachedFile(value: unknown): value is CachedFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.version === 'string' && normalizeRemoteVersion(item.version) === item.version
    && typeof item.hash === 'string' && digestPattern.test(item.hash)
    && typeof item.size === 'number' && Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= MAX_FILE_SIZE
    && typeof item.usedAt === 'number' && Number.isFinite(item.usedAt)
}

function readIndex(value: unknown): Record<string, CachedFile> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, CachedFile> = {}
  for (const [key, item] of Object.entries(value)) {
    if (/^[a-f0-9]{64}:(workspace|data):/.test(key) && isCachedFile(item)) result[key] = item
  }
  return result
}

/** A bounded, disposable optimization. Losing the cache only causes a download. */
export async function openRemoteContentCache(identity: string) {
  // Hash the target identity: credentials and server settings never enter the index.
  const namespace = await contentHash(new TextEncoder().encode(identity))
  let entries: Record<string, CachedFile> = {}
  try { entries = readIndex(await (await Store.load('sync_remote_content_cache.json')).get('entries')) }
  catch (error) { console.warn('Remote content cache index unavailable', error) }
  const changed = new Map<string, CachedFile>()
  const invalid = new Set<string>()
  const writtenHashes = new Set<string>()

  return {
    // Call only after a complete, successful listing. Cached paths never act as
    // an inventory: deleted files and obsolete versions must be discarded.
    reconcileInventory(scope: 'workspace' | 'data', files: Array<{ path: string; sha: string; size?: number }>) {
      const prefix = `${namespace}:${scope}:`
      const inventory = new Map(files.map(file => [file.path, file]))
      for (const [key, cached] of Object.entries(entries)) {
        if (!key.startsWith(prefix)) continue
        const file = inventory.get(key.slice(prefix.length))
        if (!file || normalizeRemoteVersion(file.sha) !== cached.version
          || (file.size !== undefined && file.size !== cached.size)) {
          invalid.add(key)
          changed.delete(key)
          delete entries[key]
        }
      }
    },
    async read(
      scope: 'workspace' | 'data', path: string, version: string | undefined, size: number | undefined,
      download: () => Promise<{ content: Uint8Array; version?: string }>,
    ) {
      const key = `${namespace}:${scope}:${path}`
      const expected = normalizeRemoteVersion(version)
      const cached = entries[key]
      if (expected && cached?.version === expected && (size === undefined || cached.size === size)) {
        try {
          const bytes = await readFile(`${CACHE_ROOT}/${cached.hash}.bin`, { baseDir: BaseDirectory.AppData })
          if (bytes.length === cached.size && await contentHash(bytes) === cached.hash) {
            const updated = { ...cached, usedAt: Date.now() }
            changed.set(key, updated)
            return { bytes, hash: cached.hash, version: expected, reused: true }
          }
        } catch { /* Missing or damaged cache is a miss, never remote absence. */ }
      }
      invalid.add(key)
      changed.delete(key)
      let result: Awaited<ReturnType<typeof download>>
      try { result = await download() }
      catch (error) { throw withSyncStaleContext(error, { stage: 'scan', path, source: 'remote', expected: { sha: expected, size } }) }
      const actualVersion = normalizeRemoteVersion(result.version)
      if ((expected && actualVersion && expected !== actualVersion)
        || (size !== undefined && result.content.length !== size)) throw syncStaleError({
        stage: 'scan', path, source: 'remote', check: expected && actualVersion && expected !== actualVersion ? 'version' : 'size',
        expected: { sha: expected, size }, actual: { sha: actualVersion, size: result.content.length },
      })
      const hash = await contentHash(result.content)
      // A listing alone cannot bind newly downloaded bytes to a version. The
      // GET version (or verified Git blob ID) must agree before caching them.
      const verifiedVersion = expected && actualVersion === expected ? expected : undefined
      if (verifiedVersion && result.content.length <= MAX_FILE_SIZE) {
        try {
          await mkdir(CACHE_ROOT, { baseDir: BaseDirectory.AppData, recursive: true })
          await writeFile(`${CACHE_ROOT}/${hash}.bin`, result.content, { baseDir: BaseDirectory.AppData })
          const entry = { version: verifiedVersion, hash, size: result.content.length, usedAt: Date.now() }
          entries[key] = entry
          changed.set(key, entry)
          writtenHashes.add(hash)
        } catch (error) { console.warn('Remote content cache write skipped', error) }
      }
      return { bytes: result.content, hash, version: verifiedVersion, reused: false }
    },
    async commit() {
      if (!changed.size && !invalid.size) return
      const save = commits.then(async () => {
        const store = await Store.load('sync_remote_content_cache.json')
        const current = readIndex(await store.get('entries'))
        const oldHashes = new Set(Object.values(current).map(entry => entry.hash))
        for (const key of invalid) delete current[key]
        for (const [key, value] of changed) current[key] = value
        let bytes = 0
        const kept = Object.entries(current).sort((a, b) => b[1].usedAt - a[1].usedAt)
          .filter(([, entry], index) => {
            if (index >= MAX_ENTRIES || bytes + entry.size > CACHE_BUDGET) return false
            bytes += entry.size
            return true
          })
        await store.set('entries', Object.fromEntries(kept))
        await store.save()
        const live = new Set(kept.map(([, entry]) => entry.hash))
        for (const hash of new Set([...oldHashes, ...writtenHashes])) {
          if (!live.has(hash)) {
            try { await remove(`${CACHE_ROOT}/${hash}.bin`, { baseDir: BaseDirectory.AppData }) }
            catch { /* Cache eviction does not affect sync or durable backups. */ }
          }
        }
      })
      commits = save.catch(() => {})
      try { await save }
      catch (error) { console.warn('Remote content cache commit skipped', error) }
    },
  }
}
