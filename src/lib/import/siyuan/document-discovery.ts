import { exists, lstat, readDir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { hasSiYuanNotebookMarker, isDocumentId, SIYUAN_DATA_SUBDIRS } from './utils'

export interface DiscoverSyPathsHooks {
  onDirectoryEnter?: (dirPath: string) => void
}

async function discoverSyPathsInNotebookTree(
  dirPath: string,
  hooks?: DiscoverSyPathsHooks,
): Promise<string[]> {
  hooks?.onDirectoryEnter?.(dirPath)

  const paths: string[] = []
  const entries = await readDir(dirPath)
  const documentChildDirNames = new Set(
    entries
      .filter(entry => entry.isFile && entry.name.endsWith('.sy'))
      .map(entry => entry.name.replace(/\.sy$/, ''))
      .filter(isDocumentId),
  )

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SIYUAN_DATA_SUBDIRS.has(entry.name)) {
      continue
    }

    const entryPath = await join(dirPath, entry.name)
    if (entry.isFile && entry.name.endsWith('.sy')) {
      paths.push(entryPath)
      const fileId = entry.name.replace(/\.sy$/, '')
      if (isDocumentId(fileId)) {
        const childDir = await join(dirPath, fileId)
        if (await exists(childDir)) {
          const childInfo = await lstat(childDir)
          if (childInfo.isDirectory && !childInfo.isSymlink) {
            paths.push(...await discoverSyPathsInNotebookTree(childDir, hooks))
          }
        }
      }
      continue
    }

    if (entry.isDirectory) {
      if (isDocumentId(entry.name) && documentChildDirNames.has(entry.name)) {
        continue
      }
      paths.push(...await discoverSyPathsInNotebookTree(entryPath, hooks))
    }
  }

  return paths
}

async function discoverSyPathsAtDocumentRoot(dirPath: string): Promise<string[]> {
  const paths: string[] = []
  const entries = await readDir(dirPath)

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SIYUAN_DATA_SUBDIRS.has(entry.name)) {
      continue
    }

    const entryPath = await join(dirPath, entry.name)
    if (entry.isFile && entry.name.endsWith('.sy')) {
      paths.push(entryPath)
      const fileId = entry.name.replace(/\.sy$/, '')
      if (isDocumentId(fileId)) {
        const childDir = await join(dirPath, fileId)
        if (await exists(childDir)) {
          const childInfo = await lstat(childDir)
          if (childInfo.isDirectory && !childInfo.isSymlink) {
            paths.push(...await discoverSyPathsInNotebookTree(childDir))
          }
        }
      }
    }
  }

  return paths
}

export async function listVerifiedNotebookDirectories(dataRoot: string): Promise<string[]> {
  const entries = await readDir(dataRoot)
  const notebookDirs: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SIYUAN_DATA_SUBDIRS.has(entry.name) || !entry.isDirectory) {
      continue
    }

    const entryPath = await join(dataRoot, entry.name)
    if (await hasSiYuanNotebookMarker(entryPath)) {
      notebookDirs.push(entryPath)
    }
  }

  return notebookDirs
}

export async function countRootLevelSyFiles(dataRoot: string): Promise<number> {
  const entries = await readDir(dataRoot)
  return entries.filter(entry => entry.isFile && entry.name.endsWith('.sy')).length
}

export async function discoverImportableSyPaths(dataRoot: string): Promise<string[]> {
  const notebookDirs = await listVerifiedNotebookDirectories(dataRoot)
  const discovered = new Set<string>()

  for (const notebookDir of notebookDirs) {
    for (const syPath of await discoverSyPathsInNotebookTree(notebookDir)) {
      discovered.add(syPath)
    }
  }

  for (const syPath of await discoverSyPathsAtDocumentRoot(dataRoot)) {
    discovered.add(syPath)
  }

  return [...discovered]
}

export async function countImportableSyDocuments(dataRoot: string): Promise<number> {
  return (await discoverImportableSyPaths(dataRoot)).length
}

export function assertDiscoveredDocumentsScheduled(
  discoveredCount: number,
  plannedCount: number,
  failedDuringPlanningCount: number,
): void {
  const scheduledCount = plannedCount + failedDuringPlanningCount
  if (discoveredCount !== scheduledCount) {
    throw new Error(
      `SiYuan import planning dropped ${discoveredCount - scheduledCount} document(s): `
      + `discovered ${discoveredCount}, scheduled ${scheduledCount}`,
    )
  }
}

export { discoverSyPathsInNotebookTree }
