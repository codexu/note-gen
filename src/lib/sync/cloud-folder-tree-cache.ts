import { Store } from '@tauri-apps/plugin-store'

import type { CloudFolderObject } from './cloud-folder'
import type { CloudFolderConfig } from '@/types/sync'

const CACHE_STORE_NAME = 'cloud_folder_file_tree_cache.json'
const CACHE_VERSION = 1

type CloudFolderTreeCache = {
  version: number
  updatedAt: number
  files: CloudFolderObject[]
}

let cacheStorePromise: Promise<Store> | null = null
const memoryCache = new Map<string, CloudFolderObject[]>()

function getCacheStore() {
  cacheStorePromise ??= Store.load(CACHE_STORE_NAME)
  return cacheStorePromise
}

function getCacheStoreKey(targetKey: string) {
  return `tree:${encodeURIComponent(targetKey)}`
}

export function getCloudFolderTreeCacheTargetKey(
  syncTargetKey: string,
  config: CloudFolderConfig,
) {
  return JSON.stringify([
    syncTargetKey,
    config.provider || 'folder',
    config.oneDriveClientId || '',
    config.oneDriveRootId || '',
    config.path,
  ])
}

export async function readCloudFolderTreeCache(
  targetKey: string,
): Promise<CloudFolderObject[] | null> {
  const inMemory = memoryCache.get(targetKey)
  if (inMemory) return inMemory

  const store = await getCacheStore()
  const cached = await store.get<CloudFolderTreeCache>(getCacheStoreKey(targetKey))
  if (cached?.version !== CACHE_VERSION || !Array.isArray(cached.files)) return null

  memoryCache.set(targetKey, cached.files)
  return cached.files
}

export async function writeCloudFolderTreeCache(
  targetKey: string,
  files: CloudFolderObject[],
) {
  memoryCache.set(targetKey, files)
  const store = await getCacheStore()
  await store.set(getCacheStoreKey(targetKey), {
    version: CACHE_VERSION,
    updatedAt: Date.now(),
    files,
  } satisfies CloudFolderTreeCache)
  await store.save()
}

export async function clearCloudFolderTreeCache() {
  memoryCache.clear()
  const store = await getCacheStore()
  await store.clear()
  await store.save()
}
