import { normalizeWorkspaceNamePath, useWorkspaceNamesStore } from '@/stores/workspace-names'

/** Read the folder itself, without consulting a previously assigned cloud name. */
export function getWorkspaceFolderName(path: string, defaultName: string): string {
  const segments = normalizeWorkspaceNamePath(path).split('/').filter(Boolean)
  return segments[segments.length - 1] || defaultName
}

export function getWorkspaceDisplayName(
  path: string,
  defaultName: string,
  names = useWorkspaceNamesStore.getState().names,
): string {
  const name = names[normalizeWorkspaceNamePath(path)]
  if (name) return name
  if (!path) {
    return defaultName
  }

  const normalizedPath = path.replace(/[\\/]+$/, '')
  if (!normalizedPath) {
    return defaultName
  }

  return getWorkspaceFolderName(normalizedPath, defaultName)
}
