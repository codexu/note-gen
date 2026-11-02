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

function normalizeRelativeAssetsPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, '/')
  // The workspace tree must not assign an external directory's identity to a
  // relative node that happens to have the same final path segment.
  if (!normalized || normalized.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(normalized)) return null
  const segments = normalized.split('/').filter(segment => segment && segment !== '.')
  if (!segments.length || segments.some(segment => segment === '..')) return null
  return segments.join('/')
}

/** Assets are stored relative to each note's parent directory, including nested configurations. */
export function isWritingAssetsFolder(path: string, assetsPath?: string | null): boolean {
  const directory = normalizeRelativeAssetsPath(getWritingAssetsDirName(assetsPath))
  const candidate = normalizeRelativeAssetsPath(path)
  return directory !== null && candidate !== null
    && (candidate === directory || candidate.endsWith(`/${directory}`))
}
