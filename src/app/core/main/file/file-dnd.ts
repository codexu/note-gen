import { exists, rename } from "@tauri-apps/plugin-fs"

import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { moveSelfHostedWorkspacePath } from '@/lib/self-hosted-sync/files'
import { rewriteWorkspaceMarkdownMediaPaths } from '@/lib/markdown-media-path'
import useArticleStore from '@/stores/article'

export const FILE_MANAGER_DRAG_MIME = "application/x-notegen-file-path"
let activeFileManagerDragPaths: string[] = []

export type MoveFileManagerEntryResult =
  | {
      moved: true
      sourcePath: string
      targetPath: string
      targetName: string
    }
  | {
      moved: false
      reason: "same-path" | "invalid-target"
      sourcePath: string
      targetPath: string
      targetName: string
    }

export type MoveFileManagerEntriesResult = {
  moved: Array<Extract<MoveFileManagerEntryResult, { moved: true }>>
  failed: Array<{
    path: string
    reason: 'conflict' | 'invalid-target' | 'move-failed' | 'rollback-failed'
  }>
  rolledBack: boolean
}

function normalizeDirectoryPath(path: string) {
  return path.replace(/^\/+|\/+$/g, "")
}

function getPathName(path: string) {
  return path.split("/").filter(Boolean).pop() || path
}

export function buildMoveTargetPath(sourcePath: string, targetDirectoryPath: string) {
  const normalizedTargetDirectory = normalizeDirectoryPath(targetDirectoryPath)
  const targetName = getPathName(sourcePath)
  const targetPath = normalizedTargetDirectory
    ? `${normalizedTargetDirectory}/${targetName}`
    : targetName

  return {
    targetName,
    targetPath,
  }
}

export function isInvalidFolderMoveTarget(sourcePath: string, targetDirectoryPath: string) {
  const normalizedTargetDirectory = normalizeDirectoryPath(targetDirectoryPath)

  if (!normalizedTargetDirectory) {
    return false
  }

  return normalizedTargetDirectory === sourcePath || normalizedTargetDirectory.startsWith(`${sourcePath}/`)
}

export function setFileManagerDragData(dataTransfer: DataTransfer, paths: string | string[]) {
  const normalizedPaths = Array.isArray(paths) ? paths : [paths]
  activeFileManagerDragPaths = [...normalizedPaths]
  dataTransfer.effectAllowed = "move"
  dataTransfer.setData(FILE_MANAGER_DRAG_MIME, JSON.stringify(normalizedPaths))
  dataTransfer.setData("text/plain", normalizedPaths.join("\n"))
}

export function getFileManagerDragPaths(dataTransfer: DataTransfer) {
  const payload = dataTransfer.getData(FILE_MANAGER_DRAG_MIME)
  if (payload) {
    try {
      const paths = JSON.parse(payload)
      if (Array.isArray(paths) && paths.every(path => typeof path === 'string')) {
        return paths as string[]
      }
    } catch {
      return [payload]
    }
  }

  const fallback = dataTransfer.getData("text/plain") || dataTransfer.getData("text")
  if (fallback) {
    return fallback.split("\n").filter(Boolean)
  }

  // WebKit hides DataTransfer payloads during dragenter/dragover even though
  // their MIME types remain available. Keep a snapshot for target feedback.
  return hasFileManagerDragData(dataTransfer)
    ? [...activeFileManagerDragPaths]
    : []
}

export function clearFileManagerDragData() {
  activeFileManagerDragPaths = []
}

export function getFileManagerDragPath(dataTransfer: DataTransfer) {
  return getFileManagerDragPaths(dataTransfer)[0] ?? ''
}

export function hasFileManagerDragData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(FILE_MANAGER_DRAG_MIME)
}

export function hasExternalFilesDragData(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files")
}

export async function moveFileManagerEntry(sourcePath: string, targetDirectoryPath: string): Promise<MoveFileManagerEntryResult> {
  const { targetName, targetPath } = buildMoveTargetPath(sourcePath, targetDirectoryPath)

  if (targetPath === sourcePath) {
    return {
      moved: false,
      reason: "same-path",
      sourcePath,
      targetPath,
      targetName,
    }
  }

  if (isInvalidFolderMoveTarget(sourcePath, targetDirectoryPath)) {
    return {
      moved: false,
      reason: "invalid-target",
      sourcePath,
      targetPath,
      targetName,
    }
  }

  const workspace = await getWorkspacePath()
  const oldPathOptions = await getFilePathOptions(sourcePath)
  const newPathOptions = await getFilePathOptions(targetPath)

  if (await moveSelfHostedWorkspacePath(sourcePath, targetPath)) {
    // Rust journal already completed the atomic move.
  } else if (workspace.isCustom) {
    await rename(oldPathOptions.path, newPathOptions.path)
  } else {
    await rename(oldPathOptions.path, newPathOptions.path, {
      newPathBaseDir: newPathOptions.baseDir,
      oldPathBaseDir: oldPathOptions.baseDir,
    })
  }
  await useArticleStore.getState().syncOpenTabsForPathChange(sourcePath, targetPath)

  const { renameVectorDocumentsByPrefix } = await import('@/db/vector')
  await renameVectorDocumentsByPrefix(sourcePath, targetPath)

  return {
    moved: true,
    sourcePath,
    targetPath,
    targetName,
  }
}

export async function moveFileManagerEntries(
  sourcePaths: string[],
  targetDirectoryPath: string
): Promise<MoveFileManagerEntriesResult> {
  const plans = sourcePaths
    .map(sourcePath => ({ sourcePath, ...buildMoveTargetPath(sourcePath, targetDirectoryPath) }))
    .filter(plan => plan.targetPath !== plan.sourcePath)
  const targetPaths = new Set<string>()
  const failed: MoveFileManagerEntriesResult['failed'] = []

  for (const plan of plans) {
    if (isInvalidFolderMoveTarget(plan.sourcePath, targetDirectoryPath)) {
      failed.push({ path: plan.sourcePath, reason: 'invalid-target' })
      continue
    }
    if (targetPaths.has(plan.targetPath)) {
      failed.push({ path: plan.sourcePath, reason: 'conflict' })
      continue
    }
    targetPaths.add(plan.targetPath)

    const targetOptions = await getFilePathOptions(plan.targetPath)
    const targetExists = targetOptions.baseDir
      ? await exists(targetOptions.path, { baseDir: targetOptions.baseDir })
      : await exists(targetOptions.path)
    if (targetExists) {
      failed.push({ path: plan.sourcePath, reason: 'conflict' })
    }
  }

  if (failed.length > 0) {
    return { moved: [], failed, rolledBack: false }
  }

  const moved: Array<Extract<MoveFileManagerEntryResult, { moved: true }>> = []
  try {
    for (const plan of plans) {
      const result = await moveFileManagerEntry(plan.sourcePath, targetDirectoryPath)
      if (result.moved) moved.push(result)
    }
    await rewriteWorkspaceMarkdownMediaPaths(moved.map(result => ({
      sourcePath: result.sourcePath,
      targetPath: result.targetPath,
    })))
    return { moved, failed: [], rolledBack: false }
  } catch {
    let rollbackFailed = false
    for (const result of [...moved].reverse()) {
      const originalParent = result.sourcePath.split('/').slice(0, -1).join('/')
      try {
        await moveFileManagerEntry(result.targetPath, originalParent)
      } catch {
        rollbackFailed = true
      }
    }
    return {
      moved: [],
      failed: [{
        path: plans[moved.length]?.sourcePath ?? plans[0]?.sourcePath ?? '',
        reason: rollbackFailed ? 'rollback-failed' : 'move-failed',
      }],
      rolledBack: moved.length > 0 && !rollbackFailed,
    }
  }
}

export function getPathAfterMove(path: string, sourcePath: string, targetPath: string) {
  if (path === sourcePath) {
    return targetPath
  }

  if (path.startsWith(`${sourcePath}/`)) {
    return `${targetPath}${path.slice(sourcePath.length)}`
  }

  return path
}
