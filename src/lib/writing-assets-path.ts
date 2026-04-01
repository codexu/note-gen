export function getWritingAssetsDirName(assetsPath?: string | null): string {
  const normalized = assetsPath?.trim()
  return normalized ? normalized : 'assets'
}
