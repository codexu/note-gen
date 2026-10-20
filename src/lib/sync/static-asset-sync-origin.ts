import { Store } from '@tauri-apps/plugin-store'

import type { S3Config, WebDAVConfig } from '@/types/sync'

import { getCurrentSyncContext } from './sync-context'

const STATIC_IMAGE_PATH_PATTERN = /\.(?:jpe?g|png|gif|bmp|webp|svg)$/i
const MAX_REMEMBERED_MARKERS = 4096

export type StaticAssetSyncMarker = {
  key: string
  fingerprint: string
}

const syncedContentFingerprints = new Map<string, string>()
const pathOperationLocks = new Map<string, Promise<void>>()

function normalizeStaticAssetPath(path: string): string {
  return path.replace(/\\/g, '/')
}

async function fingerprintBytes(content: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(content)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function getStaticAssetOperationKey(path: string): Promise<string> {
  const context = await getCurrentSyncContext()
  let target = context.repo

  if (context.provider === 's3') {
    const store = await Store.load('store.json')
    const config = await store.get<S3Config>('s3SyncConfig')
    target = JSON.stringify([
      config?.endpoint || '',
      config?.region || '',
      config?.bucket || '',
      config?.pathPrefix || '',
    ])
  } else if (context.provider === 'webdav') {
    const store = await Store.load('store.json')
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    target = JSON.stringify([
      config?.url || '',
      config?.username || '',
      config?.pathPrefix || '',
    ])
  }

  return JSON.stringify([context.workspaceKey, context.provider, target, path])
}

export async function createStaticAssetSyncMarker(
  path: string,
  content: Uint8Array,
  operationKey?: string,
): Promise<StaticAssetSyncMarker | null> {
  const normalizedPath = normalizeStaticAssetPath(path)
  if (!STATIC_IMAGE_PATH_PATTERN.test(normalizedPath)) return null

  const [key, fingerprint] = await Promise.all([
    operationKey ?? getStaticAssetOperationKey(normalizedPath),
    fingerprintBytes(content),
  ])
  return { key, fingerprint }
}

export function rememberStaticAssetSyncMarker(marker: StaticAssetSyncMarker | null): void {
  if (!marker) return

  syncedContentFingerprints.delete(marker.key)
  syncedContentFingerprints.set(marker.key, marker.fingerprint)
  while (syncedContentFingerprints.size > MAX_REMEMBERED_MARKERS) {
    const oldestKey = syncedContentFingerprints.keys().next().value
    if (typeof oldestKey !== 'string') break
    syncedContentFingerprints.delete(oldestKey)
  }
}

export async function withStaticAssetSyncLock<T>(
  path: string,
  operation: (operationKey?: string) => Promise<T>,
): Promise<T> {
  const normalizedPath = normalizeStaticAssetPath(path)
  if (!STATIC_IMAGE_PATH_PATTERN.test(normalizedPath)) return await operation()

  const key = await getStaticAssetOperationKey(normalizedPath)
  const previous = pathOperationLocks.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const tail = previous.catch(() => {}).then(() => current)
  pathOperationLocks.set(key, tail)

  await previous.catch(() => {})
  try {
    return await operation(key)
  } finally {
    release()
    if (pathOperationLocks.get(key) === tail) {
      pathOperationLocks.delete(key)
    }
  }
}

export async function matchesRememberedStaticAssetContent(
  path: string,
  content: Uint8Array,
  operationKey?: string,
): Promise<boolean> {
  const normalizedPath = normalizeStaticAssetPath(path)
  if (!STATIC_IMAGE_PATH_PATTERN.test(normalizedPath)) return false

  const key = operationKey ?? await getStaticAssetOperationKey(normalizedPath)
  const expectedFingerprint = syncedContentFingerprints.get(key)
  if (!expectedFingerprint) return false

  const fingerprint = await fingerprintBytes(content)
  if (syncedContentFingerprints.get(key) === expectedFingerprint) {
    syncedContentFingerprints.delete(key)
    if (fingerprint === expectedFingerprint) {
      syncedContentFingerprints.set(key, expectedFingerprint)
    }
  }
  return fingerprint === expectedFingerprint
}
