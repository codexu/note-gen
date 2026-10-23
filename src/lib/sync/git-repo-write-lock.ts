import { withRemoteWriteLock } from './remote-write-lock'

/** Repository identity is owner/repo for Gitee/Gitea, or the project ID for
 * GitLab. Endpoint paths distinguish self-hosted instances and API versions. */
export function gitRepoWriteIdentity(apiBase: string, repository: string): string {
  const url = new URL(apiBase.trim().replace(/\/+$/, ''))
  return JSON.stringify([
    'git', `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    repository.split('/').map(segment => segment.trim().toLowerCase()).join('/'),
  ])
}

/** The callback must never acquire this same repository lock again. */
export function withGitRepoWriteLock<T>(
  apiBase: string, repository: string, operation: () => Promise<T>,
): Promise<T> {
  return withRemoteWriteLock(gitRepoWriteIdentity(apiBase, repository), operation)
}
