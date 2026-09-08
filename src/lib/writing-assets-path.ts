export function getWritingAssetsDirName(assetsPath?: string | null): string {
  const normalized = assetsPath?.trim()
  return normalized ? normalized : 'assets'
}

/**
 * Return the directory name that appears in the file tree.
 *
 * Image storage keeps the configured relative path intact, but the file tree
 * exposes one path segment per node. Accept historical values such as
 * `./assets`, `assets/`, or Windows-style separators when identifying the
 * resource folder in the tree.
 */
export function getWritingAssetsFolderName(assetsPath?: string | null): string {
  const normalized = getWritingAssetsDirName(assetsPath)
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
  const segments = normalized
    .split('/')
    .filter(segment => segment && segment !== '.')

  return segments.at(-1) ?? 'assets'
}
