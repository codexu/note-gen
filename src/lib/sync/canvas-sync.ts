import { Store } from '@tauri-apps/plugin-store'
import { deleteFile as deleteGithubFile, uploadFile as uploadGithubFile, getFiles as githubGetFiles } from '@/lib/sync/github'
import { deleteFile as deleteGiteeFile, uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee'
import { deleteFile as deleteGitlabFile, uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab'
import { deleteFile as deleteGiteaFile, uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea'
import { s3Delete, s3Download, s3Upload } from '@/lib/sync/s3'
import { webdavDelete, webdavDownload, webdavUpload } from '@/lib/sync/webdav'
import { cloudFolderDelete, cloudFolderDownload, cloudFolderUpload } from '@/lib/sync/cloud-folder'
import { decodeBase64ToString, getRemoteFileContent, hasEmptyRemoteFileContent } from '@/lib/sync/remote-file'
import { getDataSyncRepoName } from '@/lib/sync/repo-utils'
import { normalizeCanvasDocument, type CanvasProject, type CanvasProjectType } from '@/types/canvas'
import type { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'

export const LEGACY_CANVAS_SYNC_PATH = '.data/canvases.json'
export const CANVAS_SYNC_DIRECTORY = '.data/canvases'
export const CANVAS_SYNC_PATH = `${CANVAS_SYNC_DIRECTORY}/index.json`
export const CANVAS_SYNC_ITEMS_DIRECTORY = `${CANVAS_SYNC_DIRECTORY}/items`

const CANVAS_SYNC_INDEX_FORMAT = 'notegen-canvases-index'
const CANVAS_SYNC_INDEX_VERSION = 1

export interface CanvasSyncIndexEntry {
  id: string
  title: string
  canvasType: CanvasProjectType
  schemaVersion: number
  createdAt: number
  updatedAt: number
  pinnedAt: number | null
  deletedAt: number | null
  path: string
}

export interface CanvasSyncIndex {
  format: typeof CANVAS_SYNC_INDEX_FORMAT
  version: typeof CANVAS_SYNC_INDEX_VERSION
  updatedAt: number
  canvases: CanvasSyncIndexEntry[]
  purged: CanvasSyncPurgeEntry[]
}

export interface CanvasSyncPurgeEntry {
  id: string
  purgedAt: number
}

interface CanvasRemoteStorage {
  read: (path: string) => Promise<string | null>
  write: (path: string, content: string) => Promise<boolean>
  remove: (path: string) => Promise<boolean>
}

const canvasTypes = new Set<CanvasProjectType>([
  'blank', 'flowchart', 'mindmap', 'timeline', 'quadrant', 'kanban', 'swot',
])

function getCanvasItemPath(id: string) {
  return `${CANVAS_SYNC_ITEMS_DIRECTORY}/${id}.json`
}

function getRemoteSha(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const sha = (value as Record<string, unknown>).sha
  return typeof sha === 'string' ? sha : undefined
}

function decodeRemoteContent(value: unknown, path: string) {
  if (!value || Array.isArray(value)) return null
  if (hasEmptyRemoteFileContent(value)) return null
  return decodeBase64ToString(getRemoteFileContent(value, path))
}

function projectToSyncValue(project: CanvasProject) {
  return {
    id: project.id,
    title: project.title,
    canvasType: project.canvasType,
    schemaVersion: project.schemaVersion,
    document: project.document,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    pinnedAt: project.pinnedAt || null,
    deletedAt: project.deletedAt || null,
  }
}

function projectToIndexEntry(project: CanvasProject): CanvasSyncIndexEntry {
  return {
    id: project.id,
    title: project.title,
    canvasType: project.canvasType,
    schemaVersion: project.schemaVersion,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    pinnedAt: project.pinnedAt || null,
    deletedAt: project.deletedAt || null,
    path: getCanvasItemPath(project.id),
  }
}

function normalizeIndexEntry(value: unknown): CanvasSyncIndexEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string'
    || typeof candidate.title !== 'string'
    || typeof candidate.createdAt !== 'number'
    || typeof candidate.updatedAt !== 'number') return null
  const canvasType: CanvasProjectType = canvasTypes.has(candidate.canvasType as CanvasProjectType)
    ? candidate.canvasType as CanvasProjectType
    : 'blank'
  return {
    id: candidate.id,
    title: candidate.title,
    canvasType,
    schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 1,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    pinnedAt: typeof candidate.pinnedAt === 'number' ? candidate.pinnedAt : null,
    deletedAt: typeof candidate.deletedAt === 'number' ? candidate.deletedAt : null,
    path: typeof candidate.path === 'string' ? candidate.path : getCanvasItemPath(candidate.id),
  }
}

function normalizePurgeEntry(value: unknown): CanvasSyncPurgeEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.purgedAt !== 'number') return null
  return {
    id: candidate.id,
    purgedAt: candidate.purgedAt,
  }
}

export function parseCanvasSyncIndex(content: string | null): CanvasSyncIndex | null {
  if (!content) return null
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const candidate = parsed as Record<string, unknown>
    if (candidate.format !== CANVAS_SYNC_INDEX_FORMAT
      || candidate.version !== CANVAS_SYNC_INDEX_VERSION
      || !Array.isArray(candidate.canvases)) return null
    const canvases = candidate.canvases.map(normalizeIndexEntry)
    if (canvases.some(entry => entry === null)) return null
    const purged = Array.isArray(candidate.purged)
      ? candidate.purged.map(normalizePurgeEntry)
      : []
    if (purged.some(entry => entry === null)) return null
    return {
      format: CANVAS_SYNC_INDEX_FORMAT,
      version: CANVAS_SYNC_INDEX_VERSION,
      updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
      canvases: canvases.filter((entry): entry is CanvasSyncIndexEntry => entry !== null),
      purged: purged.filter((entry): entry is CanvasSyncPurgeEntry => entry !== null),
    }
  } catch {
    return null
  }
}

function normalizeRemoteCanvasProject(value: unknown): CanvasProject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string'
    || typeof candidate.title !== 'string'
    || typeof candidate.createdAt !== 'number'
    || typeof candidate.updatedAt !== 'number') return null
  const canvasType: CanvasProjectType = canvasTypes.has(candidate.canvasType as CanvasProjectType)
    ? candidate.canvasType as CanvasProjectType
    : 'blank'
  return {
    id: candidate.id,
    title: candidate.title,
    canvasType,
    schemaVersion: 1,
    document: normalizeCanvasDocument(candidate.document),
    thumbnailPath: null,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    pinnedAt: typeof candidate.pinnedAt === 'number' ? candidate.pinnedAt : null,
    deletedAt: typeof candidate.deletedAt === 'number' ? candidate.deletedAt : null,
  }
}

function mergeCanvasProjects(
  local: CanvasProject[],
  remote: CanvasProject[],
  lastSyncedVersions: Record<string, number>
) {
  const projects = new Map(local.map(project => [project.id, project]))
  for (const remoteProject of remote) {
    const localProject = projects.get(remoteProject.id)
    if (!localProject) {
      projects.set(remoteProject.id, { ...remoteProject, thumbnailPath: null })
      continue
    }
    const documentsMatch = JSON.stringify(localProject.document) === JSON.stringify(remoteProject.document)
    const normalizedRemoteProject: CanvasProject = {
      ...remoteProject,
      history: localProject.history,
      thumbnailPath: documentsMatch ? localProject.thumbnailPath || null : null,
    }
    const baseVersion = lastSyncedVersions[remoteProject.id] || 0
    const hasConflict = baseVersion > 0
      && localProject.updatedAt > baseVersion
      && remoteProject.updatedAt > baseVersion
      && localProject.updatedAt !== remoteProject.updatedAt && (
      localProject.title !== remoteProject.title
      || !documentsMatch
      || localProject.pinnedAt !== remoteProject.pinnedAt
      || localProject.deletedAt !== remoteProject.deletedAt
    )
    if (hasConflict) {
      const older = remoteProject.updatedAt >= localProject.updatedAt ? localProject : normalizedRemoteProject
      const origin = older === localProject ? '本地' : '远程'
      const conflictId = `${older.id}-conflict-${origin === '本地' ? 'local' : 'remote'}-${older.updatedAt}`
      if (!projects.has(conflictId)) {
        projects.set(conflictId, {
          ...structuredClone(older),
          id: conflictId,
          title: `${older.title}（同步冲突·${origin}副本）`,
          pinnedAt: null,
          thumbnailPath: null,
          deletedAt: null,
        })
      }
    }
    if (remoteProject.updatedAt >= localProject.updatedAt) {
      projects.set(remoteProject.id, normalizedRemoteProject)
    }
  }
  return Array.from(projects.values())
}

async function createCanvasRemoteStorage(store: Store): Promise<CanvasRemoteStorage | null> {
  const provider = await store.get<string>('primaryBackupMethod') || 'github'

  if (provider === 'github') {
    const repo = await getDataSyncRepoName('github')
    return {
      read: async path => decodeRemoteContent(await githubGetFiles({ path, repo }), path),
      write: async (path, content) => {
        const existing = await githubGetFiles({ path, repo })
        return Boolean(await uploadGithubFile({
          file: content,
          repo,
          path,
          sha: getRemoteSha(existing),
          message: `Sync canvas ${path.split('/').pop() || 'data'}`,
        }))
      },
      remove: async path => {
        const existing = await githubGetFiles({ path, repo })
        const sha = getRemoteSha(existing)
        if (!sha) return true
        return Boolean(await deleteGithubFile({ path, repo, sha }))
      },
    }
  }

  if (provider === 'gitee') {
    const repo = await getDataSyncRepoName('gitee')
    return {
      read: async path => decodeRemoteContent(await giteeGetFiles({ path, repo }), path),
      write: async (path, content) => {
        const existing = await giteeGetFiles({ path, repo })
        return Boolean(await uploadGiteeFile({
          file: content,
          repo,
          path,
          sha: getRemoteSha(existing),
          message: `Sync canvas ${path.split('/').pop() || 'data'}`,
        }))
      },
      remove: async path => {
        const existing = await giteeGetFiles({ path, repo })
        const sha = getRemoteSha(existing)
        if (!sha) return true
        return Boolean(await deleteGiteeFile({ path, repo, sha }))
      },
    }
  }

  if (provider === 'gitlab') {
    const repo = await getDataSyncRepoName('gitlab')
    return {
      read: async path => decodeRemoteContent(
        await gitlabGetFileContent({ path, ref: 'main', repo }),
        path
      ),
      write: async (path, content) => {
        const existing = await gitlabGetFiles({ path, repo })
        return Boolean(await uploadGitlabFile({
          file: content,
          repo,
          path,
          sha: getRemoteSha(existing),
          message: `Sync canvas ${path.split('/').pop() || 'data'}`,
        }))
      },
      remove: async path => {
        const existing = await gitlabGetFiles({ path, repo })
        if (!existing) return true
        return Boolean(await deleteGitlabFile({ path, repo }))
      },
    }
  }

  if (provider === 'gitea') {
    const repo = await getDataSyncRepoName('gitea')
    return {
      read: async path => decodeRemoteContent(
        await giteaGetFileContent({ path, ref: 'main', repo }),
        path
      ),
      write: async (path, content) => {
        const existing = await giteaGetFiles({ path, repo })
        return Boolean(await uploadGiteaFile({
          file: content,
          repo,
          path,
          sha: getRemoteSha(existing),
          message: `Sync canvas ${path.split('/').pop() || 'data'}`,
        }))
      },
      remove: async path => {
        const existing = await giteaGetFiles({ path, repo })
        if (!existing) return true
        return Boolean(await deleteGiteaFile({ path, repo, sha: getRemoteSha(existing) }))
      },
    }
  }

  if (provider === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) return null
    return {
      read: async path => (await s3Download(config, path))?.content || null,
      write: async (path, content) => Boolean(await s3Upload(config, path, content)),
      remove: async path => s3Delete(config, path),
    }
  }

  if (provider === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    if (!config) return null
    return {
      read: async path => (await webdavDownload(config, path))?.content || null,
      write: async (path, content) => Boolean(await webdavUpload(config, path, content)),
      remove: async path => webdavDelete(config, path),
    }
  }

  if (provider === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    if (!config?.path) return null
    return {
      read: async path => (await cloudFolderDownload(config, path))?.content || null,
      write: async (path, content) => Boolean(await cloudFolderUpload(config, path, content)),
      remove: async path => cloudFolderDelete(config, path),
    }
  }

  return null
}

function indexMatchesProjects(index: CanvasSyncIndex, projects: CanvasProject[]) {
  if (index.canvases.length !== projects.length) return false
  const entries = new Map(index.canvases.map(entry => [entry.id, entry]))
  return projects.every(project => {
    const entry = entries.get(project.id)
    if (!entry) return false
    return entry.title === project.title
      && entry.canvasType === project.canvasType
      && entry.schemaVersion === project.schemaVersion
      && entry.createdAt === project.createdAt
      && entry.updatedAt === project.updatedAt
      && entry.pinnedAt === (project.pinnedAt || null)
      && entry.deletedAt === (project.deletedAt || null)
      && entry.path === getCanvasItemPath(project.id)
  })
}

export async function uploadCanvases() {
  const { getCanvasProjects } = await import('@/db/canvases')
  const projects = await getCanvasProjects({ includeDeleted: true })
  const store = await Store.load('store.json')
  const storage = await createCanvasRemoteStorage(store)
  if (!storage) return false

  const remoteIndex = parseCanvasSyncIndex(await storage.read(CANVAS_SYNC_PATH))
  const purgedIds = new Set(remoteIndex?.purged.map(entry => entry.id) || [])
  const syncableProjects = projects.filter(project => !purgedIds.has(project.id))
  const remoteEntries = new Map(remoteIndex?.canvases.map(entry => [entry.id, entry]) || [])
  const lastSyncedVersions = await store.get<Record<string, number>>('canvasSyncVersions') || {}
  const changedProjects = syncableProjects.filter(project => {
    const remoteEntry = remoteEntries.get(project.id)
    return !remoteIndex
      || !remoteEntry
      || remoteEntry.updatedAt !== project.updatedAt
      || lastSyncedVersions[project.id] !== project.updatedAt
  })

  for (const project of changedProjects) {
    const success = await storage.write(
      getCanvasItemPath(project.id),
      JSON.stringify(projectToSyncValue(project))
    )
    if (!success) return false
  }

  if (!remoteIndex || changedProjects.length > 0 || !indexMatchesProjects(remoteIndex, syncableProjects)) {
    const index: CanvasSyncIndex = {
      format: CANVAS_SYNC_INDEX_FORMAT,
      version: CANVAS_SYNC_INDEX_VERSION,
      updatedAt: Date.now(),
      canvases: syncableProjects.map(projectToIndexEntry),
      purged: remoteIndex?.purged || [],
    }
    if (!await storage.write(CANVAS_SYNC_PATH, JSON.stringify(index))) return false
  }

  await store.set('canvasSyncVersions', Object.fromEntries(
    syncableProjects.map(project => [project.id, project.updatedAt])
  ))
  await store.save()
  return true
}

export async function uploadCanvas(canvasId: string) {
  const { getCanvasProjects } = await import('@/db/canvases')
  const projects = await getCanvasProjects({ includeDeleted: true })
  const project = projects.find(candidate => candidate.id === canvasId)
  if (!project) return false

  const store = await Store.load('store.json')
  const storage = await createCanvasRemoteStorage(store)
  if (!storage) return false

  const remoteIndex = parseCanvasSyncIndex(await storage.read(CANVAS_SYNC_PATH))
  if (!remoteIndex) return uploadCanvases()
  if (remoteIndex.purged.some(entry => entry.id === project.id)) return false

  if (!await storage.write(
    getCanvasItemPath(project.id),
    JSON.stringify(projectToSyncValue(project))
  )) return false

  const nextEntry = projectToIndexEntry(project)
  const nextEntries = remoteIndex.canvases.some(entry => entry.id === project.id)
    ? remoteIndex.canvases.map(entry => entry.id === project.id ? nextEntry : entry)
    : [...remoteIndex.canvases, nextEntry]
  const nextIndex: CanvasSyncIndex = {
    ...remoteIndex,
    updatedAt: Date.now(),
    canvases: nextEntries,
  }
  if (!await storage.write(CANVAS_SYNC_PATH, JSON.stringify(nextIndex))) return false

  const lastSyncedVersions = await store.get<Record<string, number>>('canvasSyncVersions') || {}
  await store.set('canvasSyncVersions', {
    ...lastSyncedVersions,
    [project.id]: project.updatedAt,
  })
  await store.save()
  return true
}

export async function purgeCanvas(canvasId: string) {
  const store = await Store.load('store.json')
  const storage = await createCanvasRemoteStorage(store)
  if (!storage) return false

  let remoteIndex = parseCanvasSyncIndex(await storage.read(CANVAS_SYNC_PATH))
  if (!remoteIndex) {
    if (!await uploadCanvases()) return false
    remoteIndex = parseCanvasSyncIndex(await storage.read(CANVAS_SYNC_PATH))
    if (!remoteIndex) return false
  }

  const purgedAt = Date.now()
  const nextIndex: CanvasSyncIndex = {
    ...remoteIndex,
    updatedAt: purgedAt,
    canvases: remoteIndex.canvases.filter(entry => entry.id !== canvasId),
    purged: [
      ...remoteIndex.purged.filter(entry => entry.id !== canvasId),
      { id: canvasId, purgedAt },
    ],
  }
  if (!await storage.write(CANVAS_SYNC_PATH, JSON.stringify(nextIndex))) return false
  if (!await storage.remove(getCanvasItemPath(canvasId))) return false

  const legacyContent = await storage.read(LEGACY_CANVAS_SYNC_PATH)
  if (legacyContent) {
    try {
      const parsed: unknown = JSON.parse(legacyContent)
      if (!Array.isArray(parsed)) return false
      const remaining = parsed.filter(value => (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
        || (value as Record<string, unknown>).id !== canvasId
      ))
      if (remaining.length !== parsed.length) {
        const legacyUpdated = remaining.length === 0
          ? await storage.remove(LEGACY_CANVAS_SYNC_PATH)
          : await storage.write(LEGACY_CANVAS_SYNC_PATH, JSON.stringify(remaining))
        if (!legacyUpdated) return false
      }
    } catch {
      return false
    }
  }

  const lastSyncedVersions = await store.get<Record<string, number>>('canvasSyncVersions') || {}
  delete lastSyncedVersions[canvasId]
  await store.set('canvasSyncVersions', lastSyncedVersions)
  await store.save()
  return true
}

async function persistMergedCanvases(
  local: CanvasProject[],
  remote: CanvasProject[],
  store: Store
) {
  const { replaceAllCanvasProjects } = await import('@/db/canvases')
  const lastSyncedVersions = await store.get<Record<string, number>>('canvasSyncVersions') || {}
  const merged = mergeCanvasProjects(local, remote, lastSyncedVersions)
  await replaceAllCanvasProjects(merged)
  await store.set('canvasSyncVersions', Object.fromEntries(
    remote.map(project => [project.id, project.updatedAt])
  ))
  await store.save()
  return merged
}

export async function downloadCanvases(options: { allowMissingRemote?: boolean } = {}) {
  const { getCanvasProjects } = await import('@/db/canvases')
  const store = await Store.load('store.json')
  const storage = await createCanvasRemoteStorage(store)
  const local = await getCanvasProjects({ includeDeleted: true })
  if (!storage) return local

  try {
    const indexContent = await storage.read(CANVAS_SYNC_PATH)
    const index = parseCanvasSyncIndex(indexContent)

    if (index) {
      const purgedIds = new Set(index.purged.map(entry => entry.id))
      const purgedLocalProjects = local.filter(project => purgedIds.has(project.id))
      const activeLocal = local.filter(project => !purgedIds.has(project.id))
      const localById = new Map(activeLocal.map(project => [project.id, project]))
      const lastSyncedVersions = await store.get<Record<string, number>>('canvasSyncVersions') || {}
      const remoteProjects: CanvasProject[] = []

      for (const entry of index.canvases) {
        const localProject = localById.get(entry.id)
        if (localProject
          && localProject.updatedAt === entry.updatedAt
          && lastSyncedVersions[entry.id] === entry.updatedAt) {
          remoteProjects.push({
            ...localProject,
            title: entry.title,
            canvasType: entry.canvasType,
            schemaVersion: entry.schemaVersion,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            pinnedAt: entry.pinnedAt,
            deletedAt: entry.deletedAt,
          })
          continue
        }

        const itemContent = await storage.read(entry.path)
        if (!itemContent) throw new Error(`Missing remote canvas file: ${entry.path}`)
        const project = normalizeRemoteCanvasProject(JSON.parse(itemContent))
        if (!project || project.id !== entry.id) {
          throw new Error(`Invalid remote canvas file: ${entry.path}`)
        }
        remoteProjects.push(project)
      }

      const merged = await persistMergedCanvases(activeLocal, remoteProjects, store)
      if (purgedLocalProjects.length > 0) {
        const { removeCanvasThumbnail } = await import('@/lib/canvas/thumbnail')
        for (const project of purgedLocalProjects) {
          try {
            await removeCanvasThumbnail(project.thumbnailPath)
          } catch (error) {
            console.error('Failed to remove purged canvas thumbnail:', error)
          }
        }
      }
      return merged
    }

    const legacyContent = await storage.read(LEGACY_CANVAS_SYNC_PATH)
    if (!legacyContent) return local
    const parsed: unknown = JSON.parse(legacyContent)
    if (!Array.isArray(parsed)) throw new Error('Invalid legacy remote canvas data')
    const remoteProjects = parsed.map(normalizeRemoteCanvasProject)
    if (remoteProjects.some(project => project === null)) {
      throw new Error('Invalid legacy remote canvas project')
    }
    const normalizedRemoteProjects = remoteProjects.filter((project): project is CanvasProject => project !== null)
    const merged = await persistMergedCanvases(local, normalizedRemoteProjects, store)
    await uploadCanvases()
    return merged
  } catch (error) {
    if (!options.allowMissingRemote) throw error
    return local
  }
}
