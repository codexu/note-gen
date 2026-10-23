import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { exists, remove } from '@tauri-apps/plugin-fs'

import { getDefaultArticleAbsolutePath, getFilePathOptions } from '@/lib/workspace'
import { deleteSelfHostedWorkspacePath } from '@/lib/self-hosted-sync/files'
import { isMobileDevice } from '@/lib/check'

async function resolveExistingAbsolutePath(relativePath: string, workspaceRoot?: string) {
  if (workspaceRoot) {
    const absolutePath = await join(workspaceRoot, relativePath)
    return await exists(absolutePath) ? absolutePath : null
  }
  const options = await getFilePathOptions(relativePath)
  const pathExists = options.baseDir
    ? await exists(options.path, { baseDir: options.baseDir })
    : await exists(options.path)

  if (!pathExists) return null
  return options.baseDir
    ? getDefaultArticleAbsolutePath(relativePath)
    : options.path
}

export async function moveEntriesToSystemTrash(relativePaths: string[], workspaceRoot?: string) {
  let journaled = 0
  const remaining: string[] = []
  for (const relativePath of relativePaths) {
    if (!workspaceRoot && await deleteSelfHostedWorkspacePath(relativePath)) journaled++
    else remaining.push(relativePath)
  }
  const resolvedPaths = await Promise.all(remaining.map(path => resolveExistingAbsolutePath(path, workspaceRoot)))
  const paths = resolvedPaths.filter((path): path is string => Boolean(path))

  if (paths.length > 0) {
    if (isMobileDevice()) {
      for (const path of paths) await remove(path, { recursive: true })
    } else {
      await invoke('move_paths_to_trash', { paths })
    }
  }
  return journaled + paths.length
}

export async function moveEntryToSystemTrash(relativePath: string, workspaceRoot?: string) {
  return (await moveEntriesToSystemTrash([relativePath], workspaceRoot)) > 0
}
