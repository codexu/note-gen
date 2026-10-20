import { appDataDir, join } from '@tauri-apps/api/path'
import { mkdir, readDir } from '@tauri-apps/plugin-fs'

import {
  androidCloudFolderWorkspaceList,
  migrateWorkspaceToCloudFolder,
  type CloudFolderObject,
  type WorkspaceMigrationResult,
} from './cloud-folder'
import type { CloudFolderConfig } from '@/types/sync'

export type OneDriveWorkspacePreparation = {
  path: string
  mode: 'pull' | 'upload' | 'merge'
  remoteFiles: CloudFolderObject[]
  migration?: WorkspaceMigrationResult
}

export type OneDriveWorkspaceStrategy = 'remote' | 'current' | 'resume'

function stableWorkspaceKey(config: CloudFolderConfig): string {
  const identity = `${config.oneDriveClientId || ''}\0${config.oneDriveRootId || config.path}`
  let hash = 0x811c9dc5
  for (let index = 0; index < identity.length; index++) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export async function getOneDriveWorkspacePath(config: CloudFolderConfig): Promise<string> {
  return await join(
    await appDataDir(),
    'workspaces',
    'onedrive',
    stableWorkspaceKey(config),
  )
}

export async function prepareOneDriveWorkspace(
  config: CloudFolderConfig,
  sourceWorkspacePath?: string,
  strategy: OneDriveWorkspaceStrategy = 'resume',
): Promise<OneDriveWorkspacePreparation> {
  const path = config.oneDriveWorkspacePath || await getOneDriveWorkspacePath(config)
  await mkdir(path, { recursive: true })

  const [entries, remoteFiles] = await Promise.all([
    readDir(path),
    androidCloudFolderWorkspaceList(config),
  ])
  const hasLocalFiles = entries.some(entry => !entry.name.startsWith('.') && !entry.isSymlink)

  if (strategy === 'remote') {
    return {
      path,
      mode: hasLocalFiles && remoteFiles.length > 0 ? 'merge' : 'pull',
      remoteFiles,
    }
  }

  if (strategy === 'current') {
    const migration = await migrateWorkspaceToCloudFolder(
      { path },
      sourceWorkspacePath?.trim() || undefined,
    )
    return {
      path,
      mode: remoteFiles.length > 0 ? 'merge' : 'upload',
      remoteFiles,
      migration,
    }
  }

  if (hasLocalFiles && remoteFiles.length > 0) {
    return { path, mode: 'merge', remoteFiles }
  }
  if (remoteFiles.length > 0) {
    return { path, mode: 'pull', remoteFiles }
  }

  const migration = hasLocalFiles
    ? undefined
    : await migrateWorkspaceToCloudFolder(
        { path },
        sourceWorkspacePath?.trim() || undefined,
      )
  return { path, mode: 'upload', remoteFiles, migration }
}
