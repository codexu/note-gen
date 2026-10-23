import { fetch, type ClientOptions } from '@tauri-apps/plugin-http'
import { isRemoteConnectionError } from './remote-mutation-recovery'

export type GiteeReadOptions = Omit<RequestInit, 'method' | 'body'> & ClientOptions

function requestError(path: string, connection = false, aborted = false) {
  const error = new Error(`${connection ? 'SYNC_GITEE_CONNECTION_FAILED' : 'SYNC_GITEE_REQUEST_FAILED'}: ${path}`)
  if (aborted) error.name = 'AbortError'
  return error
}

function errorText(error: unknown) {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return ''
}

function isAborted(error: unknown, signal?: AbortSignal | null) {
  if (signal?.aborted) return true
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return true
  const message = errorText(error).replace(/https?:\/\/[^\s)"'<>]+/gi, '[url]')
  return /\baborterror\b|\brequest (?:was )?(?:cancel(?:led|ed)|aborted)\b|\boperation (?:was )?cancel(?:led|ed)\b/i.test(message)
}

export function isGiteeConnectionError(error: unknown) {
  return isRemoteConnectionError(error)
}

/** Retry only read requests rejected by the native network transport. */
export async function fetchGiteeRead(url: string, options: GiteeReadOptions = {}): Promise<Response> {
  let path = 'Gitee'
  let parsed: URL
  try {
    parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) throw requestError(path)
    path = `${parsed.origin}${parsed.pathname}`
  } catch { throw requestError(path) }

  // Keep the runtime boundary read-only even if an untyped caller bypasses the
  // options type. Git receive-pack writes use their own non-retrying transport.
  const runtimeOptions = (options || {}) as RequestInit & ClientOptions
  if ((runtimeOptions.method !== undefined
      && (typeof runtimeOptions.method !== 'string' || runtimeOptions.method.toUpperCase() !== 'GET'))
    || runtimeOptions.body != null || parsed.pathname.endsWith('/git-receive-pack')) {
    throw requestError(path)
  }
  const { method: _method, body: _body, ...readOptions } = runtimeOptions
  void _method; void _body

  for (let attempt = 0; attempt < 3; attempt++) {
    if (readOptions.signal?.aborted) throw requestError(path, false, true)
    try {
      // Tauri's wrapper deletes its native options from init. Clone them and
      // Headers for every attempt so retries retain timeouts and proxy settings.
      return await fetch(url, {
        ...readOptions,
        method: 'GET',
        headers: new Headers(readOptions.headers),
        connectTimeout: readOptions.connectTimeout ?? 10_000,
        maxRedirections: readOptions.maxRedirections ?? 0,
      })
    } catch (error) {
      if (isAborted(error, readOptions.signal)) throw requestError(path, false, true)
      if (!isGiteeConnectionError(error)) throw requestError(path)
      if (attempt === 2) throw requestError(path, true)
      await new Promise<void>(resolve => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw requestError(path, true)
}
