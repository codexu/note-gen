import { invoke } from '@tauri-apps/api/core'
import { exists } from '@tauri-apps/plugin-fs'

import { getDefaultArticleAbsolutePath, getFilePathOptions } from '@/lib/workspace'
import { deleteSelfHostedWorkspacePath } from '@/lib/self-hosted-sync/files'

async function resolveExistingAbsolutePath(relativePath: string) {
  const options = await getFilePathOptions(relativePath)
  const pathExists = options.baseDir
    ? await exists(options.path, { baseDir: options.baseDir })
    : await exists(options.path)

  if (!pathExists) return null
  return options.baseDir
    ? getDefaultArticleAbsolutePath(relativePath)
    : options.path
}

export async function moveEntriesToSystemTrash(relativePaths: string[]) {
  let journaled = 0
  const remaining: string[] = []
  for (const relativePath of relativePaths) {
    if (await deleteSelfHostedWorkspacePath(relativePath)) journaled++
    else remaining.push(relativePath)
  }
  const resolvedPaths = await Promise.all(remaining.map(resolveExistingAbsolutePath))
  const paths = resolvedPaths.filter((path): path is string => Boolean(path))

  if (paths.length > 0) await invoke('move_paths_to_trash', { paths })
  return journaled + paths.length
}

export async function moveEntryToSystemTrash(relativePath: string) {
  return (await moveEntriesToSystemTrash([relativePath])) > 0
}
