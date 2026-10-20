import { stat } from '@tauri-apps/plugin-fs'
import { getWorkspacePath, toWorkspaceRelativePath } from '@/lib/workspace'

const OPENABLE_EXTENSIONS = new Set(['md', 'markdown'])

export async function resolveOpenedMarkdownPath(path: string): Promise<string | null> {
  const normalizedPath = path.trim().replace(/\\/g, '/')
  const extension = normalizedPath.split('.').pop()?.toLowerCase()

  if (!extension || !OPENABLE_EXTENSIONS.has(extension)) {
    return null
  }

  try {
    const fileStat = await stat(path)
    if (!fileStat.isFile) {
      return null
    }
  } catch {
    return null
  }

  const workspace = await getWorkspacePath()
  if (workspace.isCustom) {
    const workspacePath = workspace.path.replace(/\\/g, '/').replace(/\/$/, '')
    if (normalizedPath === workspacePath || normalizedPath.startsWith(`${workspacePath}/`)) {
      return await toWorkspaceRelativePath(normalizedPath)
    }
  }

  return normalizedPath
}
