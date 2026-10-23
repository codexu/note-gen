import { withRemoteWriteLock } from './remote-write-lock'

/** Serialize this application's writes to one repository. The operation must
 * not acquire the workspace rename journal lock while holding this lock. */
export async function withGithubRepoWriteLock<T>(
  owner: string, repo: string, operation: () => Promise<T>,
): Promise<T> {
  const key = JSON.stringify(['github', owner.trim().toLowerCase(), repo.trim().toLowerCase()])
  return await withRemoteWriteLock(key, operation)
}
