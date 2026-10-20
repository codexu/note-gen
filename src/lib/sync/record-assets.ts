import { BaseDirectory, exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import emitter from '@/lib/emitter'
import { recordSyncTiming } from './sync-timing'
import {
  deleteRemoteFile,
  downloadRemoteBytes,
  getRemoteContentType,
  remoteFileExists,
  uploadRemoteBytes,
} from './remote-library'

type RecordAssetMark = {
  type: 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording' | 'todo'
  url: string
  content?: string
}

const HTTP_URL_PATTERN = /^https?:\/\//i
const RECORD_ASSET_REMOTE_DIR = '.data/assets/records'
const PENDING_RECORD_ASSET_DELETIONS_KEY = 'pendingRecordAssetRemoteDeletions'

function normalizeStoredPath(path: string): string {
  return path.replace(/^[/\\]+/, '').replace(/\\/g, '/')
}

function getStoredFileName(path: string): string {
  const normalizedPath = normalizeStoredPath(path)
  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] || ''
}

export function getMarkLocalAssetPath(mark: RecordAssetMark): string | null {
  if (!mark.url || HTTP_URL_PATTERN.test(mark.url)) return null

  if (mark.type === 'scan') {
    const fileName = getStoredFileName(mark.url)
    return fileName ? `screenshot/${fileName}` : null
  }

  if (mark.type === 'image') {
    const fileName = getStoredFileName(mark.url)
    return fileName ? `image/${fileName}` : null
  }

  if (mark.type === 'recording') {
    return normalizeStoredPath(mark.url) || null
  }

  return null
}

export function getMarkLocalAssetPaths(mark: RecordAssetMark): string[] {
  const paths: string[] = []
  const primaryPath = getMarkLocalAssetPath(mark)
  if (primaryPath) paths.push(primaryPath)

  if (mark.type === 'link' && mark.content) {
    const matches = mark.content.match(/link-assets\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+/g) || []
    paths.push(...matches.map(normalizeStoredPath))
  }

  return Array.from(new Set(paths))
}

function getRemoteAssetPath(localPath: string): string {
  return `${RECORD_ASSET_REMOTE_DIR}/${normalizeStoredPath(localPath)}`
}

async function ensureLocalAssetDirectory(localPath: string) {
  const directory = localPath.split('/').slice(0, -1).join('/')
  if (directory && !await exists(directory, { baseDir: BaseDirectory.AppData })) {
    await mkdir(directory, { baseDir: BaseDirectory.AppData, recursive: true })
  }
}

export async function queueRecordAssetRemoteDeletions(marks: RecordAssetMark[]) {
  const paths = marks
    .flatMap(getMarkLocalAssetPaths)
    .map(getRemoteAssetPath)
  if (paths.length === 0) return

  const store = await Store.load('store.json')
  const pending = await store.get<string[]>(PENDING_RECORD_ASSET_DELETIONS_KEY) || []
  await store.set(PENDING_RECORD_ASSET_DELETIONS_KEY, Array.from(new Set([...pending, ...paths])))
  await store.save()
}

async function flushPendingRecordAssetRemoteDeletions() {
  const store = await Store.load('store.json')
  const pending = await store.get<string[]>(PENDING_RECORD_ASSET_DELETIONS_KEY) || []
  if (pending.length === 0) return

  const remaining = [...pending]
  for (const path of pending) {
    await deleteRemoteFile(path, 'data')
    remaining.shift()
    await store.set(PENDING_RECORD_ASSET_DELETIONS_KEY, remaining)
    await store.save()
  }
}

export async function uploadRecordAssets(marks: RecordAssetMark[]) {
  const startedAt = Date.now()
  await flushPendingRecordAssetRemoteDeletions()

  const localPaths = Array.from(new Set(
    marks.flatMap(getMarkLocalAssetPaths)
  ))

  let uploaded = 0
  let skipped = 0
  for (const localPath of localPaths) {
    if (!await exists(localPath, { baseDir: BaseDirectory.AppData })) continue
    const remotePath = getRemoteAssetPath(localPath)
    if (await remoteFileExists(remotePath, 'data')) {
      skipped += 1
      continue
    }

    const content = await readFile(localPath, { baseDir: BaseDirectory.AppData })
    await uploadRemoteBytes(
      remotePath,
      content,
      `Upload record asset: ${localPath}`,
      getRemoteContentType(localPath),
      'data',
    )
    uploaded += 1
  }
  recordSyncTiming('recordAssetsUpload', startedAt, {
    total: localPaths.length,
    uploaded,
    skipped,
  })
}

export async function downloadRecordAssets(marks: RecordAssetMark[]) {
  const startedAt = Date.now()
  const localPaths = Array.from(new Set(
    marks.flatMap(getMarkLocalAssetPaths)
  ))

  const downloadedPaths: string[] = []

  for (const localPath of localPaths) {
    if (await exists(localPath, { baseDir: BaseDirectory.AppData })) continue
    const remotePath = getRemoteAssetPath(localPath)
    if (!await remoteFileExists(remotePath, 'data')) continue

    const content = await downloadRemoteBytes(remotePath, 'data')
    await ensureLocalAssetDirectory(localPath)
    await writeFile(localPath, content, { baseDir: BaseDirectory.AppData })
    downloadedPaths.push(localPath)
  }

  if (downloadedPaths.length > 0) {
    emitter.emit('record-assets-downloaded', { paths: downloadedPaths })
  }
  recordSyncTiming('recordAssetsDownload', startedAt, {
    total: localPaths.length,
    downloaded: downloadedPaths.length,
  })
}
