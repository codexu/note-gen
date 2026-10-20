export function buildRemotePathsToLoad(expandedPaths: string[]): string[] {
  const uniquePaths = new Set<string>([''])

  for (const path of expandedPaths) {
    const parts = path.split('/').filter(Boolean)
    for (let index = 0; index < parts.length; index += 1) {
      uniquePaths.add(parts.slice(0, index + 1).join('/'))
    }
  }

  return Array.from(uniquePaths)
}
