import { fetch, type ClientOptions } from '@tauri-apps/plugin-http'

export type RemoteMutationObservation<T> =
  | { state: 'applied'; value: T }
  | { state: 'unchanged' }

/** A localized transport failure whose mutation still needs remote readback. */
export class RemoteMutationTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteMutationTransportError'
  }
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return ''
}

/** Classify native transport failures only, never HTTP responses or file I/O. */
export function isRemoteConnectionError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return false
  if (error instanceof RemoteMutationTransportError) return true
  // A file name or query parameter cannot classify the transport failure.
  const message = errorText(error).replace(/https?:\/\/[^\s)"'<>]+/gi, '[url]')
  if (/capabilit|permission|not allowed|denied|forbidden|scope|invalid (?:url|uri|header)|(?:url|uri) (?:is )?invalid|unsupported (?:scheme|protocol)|certificate|\btls\b|\bssl\b|builder error|failed to parse|relative url|empty host|\baborterror\b|\brequest (?:was )?(?:cancel(?:led|ed)|aborted)\b|\boperation (?:was )?cancel(?:led|ed)\b/i.test(message)) return false
  return /error sending request\b|failed to (?:fetch|connect)\b|network(?:error| error| request failed)\b|connection (?:refused|reset|closed|aborted)\b|error (?:trying to )?connect(?:ing)?\b|error reading a body from connection\b|(?:connection|stream).*(?:unexpected eof|premature|reset|closed)|\btimed? out\b|\btimeout\b|\bdns error\b/i.test(message)
}

/** Native read retries never replay a mutation or discard proxy/timeouts. */
export async function recoverRemoteRead<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await send() }
    catch (error) {
      if (!isRemoteConnectionError(error) || attempt === 2) throw error
      await new Promise<void>(resolve => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw new Error('Remote read could not be confirmed')
}

export async function fetchRemoteRead(url: string, options: Omit<RequestInit, 'method' | 'body'> & ClientOptions & {
  method?: 'GET' | 'HEAD'
} = {}): Promise<Response> {
  const runtimeOptions = options as RequestInit & ClientOptions
  const method = runtimeOptions.method?.toUpperCase() ?? 'GET'
  if (!['GET', 'HEAD'].includes(method) || runtimeOptions.body != null) {
    throw new Error('Remote read transport requires GET or HEAD without a body')
  }
  return recoverRemoteRead(() => {
    if (options.signal?.aborted) throw new DOMException('Request canceled', 'AbortError')
    return fetch(url, {
      ...options, method, headers: new Headers(options.headers),
      connectTimeout: options.connectTimeout ?? 10_000,
      maxRedirections: options.maxRedirections ?? 0,
    })
  })
}

/** Reconcile an ambiguous write before replaying the same frozen condition.
 * send must contain only the native request. Inspect HTTP status afterwards,
 * so permission errors and rejected conditions can never enter this retry loop.
 * reconcile must throw unless it proves the result or the original version.
 */
export async function recoverRemoteMutation<T>({ send, reconcile, beforeWrite, maxAttempts = 3 }: {
  send: () => Promise<T>
  reconcile: () => Promise<RemoteMutationObservation<T>>
  beforeWrite?: () => Promise<void>
  maxAttempts?: number
}): Promise<T> {
  const attempts = Number.isFinite(maxAttempts) ? Math.min(3, Math.max(1, Math.trunc(maxAttempts))) : 3
  for (let attempt = 0; attempt < attempts; attempt++) {
    // A cancelled operation or changed local context must not trigger a send.
    await beforeWrite?.()
    try {
      return await send()
    } catch (error) {
      if (!isRemoteConnectionError(error)) throw error
      // Inspect even the final failed attempt: the server may have committed it.
      const observation = await reconcile()
      if (observation.state === 'applied') return observation.value
      if (attempt + 1 === attempts) throw error
      await new Promise<void>(resolve => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw new Error('Remote mutation could not be confirmed')
}
