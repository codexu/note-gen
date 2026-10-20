let version = 0

export function getMemoryCacheVersion() {
  return version
}

export function invalidateMemoryCache() {
  version += 1
}
