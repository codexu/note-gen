const pendingWrites = new Map<string, Promise<void>>()

/** Serialize this application's writes to one repository. The operation must
 * not acquire the workspace rename journal lock while holding this lock. */
export async function withGithubRepoWriteLock<T>(
  owner: string, repo: string, operation: () => Promise<T>,
): Promise<T> {
  const key = JSON.stringify([owner.trim().toLowerCase(), repo.trim().toLowerCase()])
  const previous = pendingWrites.get(key) || Promise.resolve()
  const result = previous.then(operation, operation)
  const settled = result.then(() => undefined, () => undefined)
  pendingWrites.set(key, settled)
  try {
    return await result
  } finally {
    if (pendingWrites.get(key) === settled) pendingWrites.delete(key)
  }
}
