export function getWorkspaceDisplayName(path: string, defaultName: string): string {
  if (!path) {
    return defaultName
  }

  const normalizedPath = path.replace(/[\\/]+$/, '')
  if (!normalizedPath) {
    return defaultName
  }

  const segments = normalizedPath.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] || defaultName
}
