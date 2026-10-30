import { fetch } from '@tauri-apps/plugin-http'
import type {
  ApiErrorBody, ClientSession, ServerCapabilities, SyncCommandResult,
  SyncBootstrapPage, SyncEventsPage, SyncSession, WorkspaceCapability,
  WorkspaceInvitation, WorkspaceMember, WorkspaceSummary,
} from './protocol'
import { SELF_HOSTED_PROTOCOL_VERSION } from './protocol'

export interface NormalizedServerUrl {
  url: string
  insecureHttp: boolean
  local: boolean
}

export class SelfHostedApiError extends Error {
  constructor(readonly body: ApiErrorBody, readonly status: number) {
    super(formatApiErrorMessage(body))
    this.name = 'SelfHostedApiError'
  }
}

function formatApiErrorMessage(body: ApiErrorBody) {
  const fieldErrors = body.details?.fieldErrors
  if (!fieldErrors || typeof fieldErrors !== 'object' || Array.isArray(fieldErrors)) return body.message
  const first = Object.entries(fieldErrors)[0]
  if (!first) return body.message
  return `${body.message}: ${first[0]} ${String(first[1])}`
}

/** The native HTTP plugin can stall while reading a response body as well as
 * connecting. Bound the complete operation and abort its native request. The
 * race also releases the sync queue if cancellation itself stalls in the IPC. */
const activeRequestCancellations = new Set<() => void>()

export function cancelSelfHostedRequests() {
  for (const cancel of [...activeRequestCancellations]) cancel()
}

/** Keep cancellation registered across local reads, encryption and SQLite
 * awaits between HTTP requests. Cooperative checks prevent the next request
 * from starting after a cancellation that happened between two parts. */
export async function withSelfHostedRequestScope<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(new SelfHostedApiError({
    code: 'request_cancelled', message: 'SELF_HOSTED_API_REQUEST_CANCELLED', requestId: '', retryable: false,
  }, 0))
  activeRequestCancellations.add(onAbort)
  externalSignal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (externalSignal?.aborted) onAbort()
    controller.signal.throwIfAborted()
    const result = await operation(controller.signal)
    controller.signal.throwIfAborted()
    return result
  } finally {
    activeRequestCancellations.delete(onAbort)
    externalSignal?.removeEventListener('abort', onAbort)
  }
}

async function boundedRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController()
  let rejectCancelled: (error: SelfHostedApiError) => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject })
  const abort = (code: 'request_timeout' | 'request_cancelled') => {
    rejectCancelled(new SelfHostedApiError({
      code, message: code === 'request_timeout' ? 'SELF_HOSTED_API_REQUEST_TIMEOUT' : 'SELF_HOSTED_API_REQUEST_CANCELLED',
      requestId: '', retryable: code === 'request_timeout',
    }, 0))
    controller.abort()
  }
  const onAbort = () => abort('request_cancelled')
  activeRequestCancellations.add(onAbort)
  externalSignal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => abort('request_timeout'), timeoutMs)
  try {
    if (externalSignal?.aborted) onAbort()
    return await Promise.race([
      cancelled,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('request_cancelled')
        return operation(controller.signal)
      }),
    ])
  } finally {
    activeRequestCancellations.delete(onAbort)
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onAbort)
  }
}

export function normalizeServerUrl(value: string): NormalizedServerUrl {
  const trimmed = value.trim()
  const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('服务器地址必须使用 HTTP 或 HTTPS')
  }
  if (parsed.username || parsed.password) throw new Error('服务器地址不能包含用户名或密码')
  if (parsed.search || parsed.hash) throw new Error('服务器地址不能包含查询参数或锚点')
  const local = parsed.hostname === 'localhost'
    || parsed.hostname === '127.0.0.1'
    || parsed.hostname === '::1'
    || parsed.hostname.endsWith('.localhost')
  return {
    url: parsed.origin,
    insecureHttp: parsed.protocol === 'http:' && !local,
    local,
  }
}

export class SelfHostedClient {
  private bootstrapReleaseSupported: boolean | undefined
  readonly baseUrl: string

  constructor(
    serverUrl: string,
    private readonly accessToken?: string,
    private readonly onAuthenticationRejected?: () => Promise<void>,
  ) {
    this.baseUrl = normalizeServerUrl(serverUrl).url
  }

  async capabilities() {
    const capabilities = await this.request<ServerCapabilities>('/v1/capabilities')
    this.bootstrapReleaseSupported = capabilities.features.bootstrapRelease === true
    return capabilities
  }

  login(input: { login: string; password: string; totpCode?: string; deviceId: string; deviceName: string; platform: string; encryptionPublicKey?: string }) {
    return this.request<ClientSession>('/v1/auth/login', { method: 'POST', body: input })
  }

  async refresh(refreshToken: string, deviceId: string, refreshRequestId: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        const session = await this.request<unknown>('/v1/auth/refresh', {
          method: 'POST', body: { refreshToken, deviceId, refreshRequestId },
        })
        if (!session || typeof session !== 'object'
          || !('accountId' in session) || typeof session.accountId !== 'string' || !session.accountId
          || !('deviceId' in session) || session.deviceId !== deviceId
          || !('accessToken' in session) || typeof session.accessToken !== 'string' || !session.accessToken
          || !('refreshToken' in session) || typeof session.refreshToken !== 'string' || !session.refreshToken
          || !('accessTokenExpiresIn' in session) || typeof session.accessTokenExpiresIn !== 'number'
          || !Number.isFinite(session.accessTokenExpiresIn) || session.accessTokenExpiresIn <= 0) {
          throw new SelfHostedApiError({ code: 'invalid_response',
            message: 'SELF_HOSTED_API_INVALID_RESPONSE: HTTP 200 /v1/auth/refresh',
            requestId: '', retryable: true }, 200)
        }
        return session as ClientSession
      } catch (error) {
        // Reuse both the token and request ID: the server can recover a rotation
        // whose response was lost without treating it as token reuse.
        if (attempt !== 0 || !(error instanceof SelfHostedApiError)
          || error.body.code !== 'invalid_response' || !error.body.retryable) throw error
        console.warn('[self-hosted-sync] Retrying malformed refresh response', { status: error.status })
      }
    }
  }

  createDeviceAuthorization(input: {
    deviceId: string; deviceName: string; platform: string; encryptionPublicKey: string
  }) {
    return this.request<{
      deviceCode: string; userCode: string; expiresIn: number; interval: number
      verificationUri: string; verificationUriComplete: string
    }>('/v1/device-authorizations', { method: 'POST', body: input })
  }

  exchangeDeviceAuthorization(deviceCode: string) {
    return this.request<ClientSession>('/v1/device-authorizations/token', {
      method: 'POST', body: { deviceCode },
    })
  }

  cancelDeviceAuthorization(deviceCode: string) {
    return this.request<null>('/v1/device-authorizations/cancel', {
      method: 'POST', body: { deviceCode },
    })
  }

  workspaces() {
    return this.request<WorkspaceSummary[]>('/v1/workspaces')
  }

  ensureAccountDataWorkspace(nameCiphertext: string, managedKey: string) {
    return this.request<{
      id: string; created: boolean; encryptionMode: 'managed' | 'e2ee'
      createdAt: string; latestSequence: string; nameCiphertext: string
    }>('/v1/workspaces/default', {
      method: 'POST', body: { nameCiphertext, managedKey },
    })
  }

  createLibrary(nameCiphertext: string, managedKey: string, idempotencyKey: string) {
    return this.request<{ id: string; created: boolean; createdAt: string; latestSequence: string; nameCiphertext: string }>(
      '/v1/workspaces',
      { method: 'POST', body: { nameCiphertext, managedKey }, headers: { 'idempotency-key': idempotencyKey } },
    )
  }

  workspaceCreationRequest(idempotencyKey: string) {
    return this.request<{ id: string; createdAt: string }>(
      `/v1/workspace-creation-requests/${encodeURIComponent(idempotencyKey)}`,
    )
  }

  deleteWorkspace(workspaceId: string) {
    return this.request<null>(`/v1/workspaces/${workspaceId}`, { method: 'DELETE' })
  }

  renameWorkspace(workspaceId: string, nameCiphertext: string) {
    return this.request<{ id: string; nameCiphertext: string; updatedAt: string }>(
      `/v1/workspaces/${workspaceId}`, { method: 'PATCH', body: { nameCiphertext } },
    )
  }

  workspaceKeys(workspaceId: string) {
    return this.request<Array<{
      keyVersion: number
      createdAt: string
      envelopes: Array<{
        type: 'passphrase' | 'recovery' | 'device' | 'managed'
        wrappedKey: string
      }>
    }>>(`/v1/workspaces/${workspaceId}/keys`)
  }

  members(workspaceId: string) {
    return this.request<WorkspaceMember[]>(`/v1/workspaces/${workspaceId}/members`)
  }

  invitations(workspaceId: string) {
    return this.request<WorkspaceInvitation[]>(`/v1/workspaces/${workspaceId}/invitations`)
  }

  pendingInvitations() {
    return this.request<WorkspaceInvitation[]>('/v1/workspace-invitations')
  }

  inviteAccount(workspaceId: string, input: {
    login: string
    role: 'viewer' | 'editor' | 'manager'
    capabilities?: WorkspaceCapability[]
  }) {
    return this.request<WorkspaceInvitation>(`/v1/workspaces/${workspaceId}/invitations/account`, {
      method: 'POST', body: input,
    })
  }

  createInvitationLink(workspaceId: string, input: {
    role: 'viewer' | 'editor' | 'manager'
    capabilities?: WorkspaceCapability[]
  }) {
    return this.request<WorkspaceInvitation>(`/v1/workspaces/${workspaceId}/invitations/link`, {
      method: 'POST', body: input,
    })
  }

  acceptInvitation(invitationId: string) {
    return this.request<{ workspaceId: string }>(`/v1/workspace-invitations/${invitationId}/accept`, {
      method: 'POST',
    })
  }

  acceptInvitationLink(token: string) {
    return this.request<{ workspaceId: string }>('/v1/workspace-invitations/accept-link', {
      method: 'POST', body: { token },
    })
  }

  updateMember(workspaceId: string, accountId: string, input: {
    role: 'viewer' | 'editor' | 'manager'
    capabilities?: WorkspaceCapability[]
  }) {
    return this.request<WorkspaceMember>(`/v1/workspaces/${workspaceId}/members/${accountId}`, {
      method: 'PATCH', body: input,
    })
  }

  removeMember(workspaceId: string, accountId: string) {
    return this.request<null>(`/v1/workspaces/${workspaceId}/members/${accountId}`, { method: 'DELETE' })
  }

  revokeInvitation(workspaceId: string, invitationId: string) {
    return this.request<null>(`/v1/workspaces/${workspaceId}/invitations/${invitationId}`, { method: 'DELETE' })
  }

  syncSession(workspaceId: string, cursor: string, expectedSyncEpoch?: string) {
    const query = new URLSearchParams({
      protocolVersion: String(SELF_HOSTED_PROTOCOL_VERSION),
      cursor,
      ...(expectedSyncEpoch ? { expectedSyncEpoch } : {}),
    })
    return this.request<SyncSession>(`/v1/workspaces/${workspaceId}/sync/session?${query}`)
  }

  pushCommands(workspaceId: string, commands: unknown[], expectedSyncEpoch: string) {
    return this.request<{ results: SyncCommandResult[]; syncEpoch: string }>(
      `/v1/workspaces/${workspaceId}/sync/commands`,
      { method: 'POST', body: { commands, expectedSyncEpoch } },
    )
  }

  events(workspaceId: string, after: string, limit: number, expectedSyncEpoch: string) {
    const query = new URLSearchParams({ after, limit: String(limit), expectedSyncEpoch })
    return this.request<SyncEventsPage>(`/v1/workspaces/${workspaceId}/sync/events?${query}`)
  }

  acknowledge(workspaceId: string, through: string, expectedSyncEpoch: string) {
    return this.request<{ acknowledgedSequence: string; syncEpoch: string }>(
      `/v1/workspaces/${workspaceId}/sync/ack`,
      { method: 'POST', body: { through, expectedSyncEpoch } },
    )
  }

  createBlobUpload(workspaceId: string, input: {
    blobId: string
    expectedSize: string
    ciphertextHash: string
    expectedSyncEpoch: string
  }, signal?: AbortSignal) {
    return this.request<{
      alreadyExists: boolean
      resumed: boolean
      blobId: string
      uploadId: string | null
      partBytes: number
      uploadedParts: Array<{ partNumber: number; etag: string; size: string }>
      expiresAt: string | null
    }>(`/v1/workspaces/${workspaceId}/blobs/uploads`, { method: 'POST', body: input, signal })
  }

  async uploadBlobPart(workspaceId: string, uploadId: string, partNumber: number, bytes: Uint8Array, signal?: AbortSignal) {
    return boundedRequest(async requestSignal => {
      const response = await fetch(
        `${this.baseUrl}/v1/workspaces/${workspaceId}/blobs/uploads/${uploadId}/parts/${partNumber}`,
        {
          method: 'PUT',
          signal: requestSignal,
          connectTimeout: 15_000,
          maxRedirections: 0,
          headers: {
            'content-type': 'application/octet-stream',
            ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: bytes,
        }
      )
      requestSignal.throwIfAborted()
      const value = await response.json() as { partNumber: number; etag: string; receivedSize: string } | ApiErrorBody
      if (!response.ok) {
        if (response.status === 401) await this.onAuthenticationRejected?.()
        throw new SelfHostedApiError(value as ApiErrorBody, response.status)
      }
      return value as { partNumber: number; etag: string; receivedSize: string }
    }, signal, 120_000)
  }

  completeBlobUpload(workspaceId: string, uploadId: string, expectedSyncEpoch: string, signal?: AbortSignal) {
    return this.request<{ blobId: string; size: string; ciphertextHash: string }>(
      `/v1/workspaces/${workspaceId}/blobs/uploads/${uploadId}/complete`,
      { method: 'POST', body: { expectedSyncEpoch }, signal },
    )
  }

  async downloadBlob(workspaceId: string, blobId: string, signal?: AbortSignal) {
    return boundedRequest(async requestSignal => {
      const response = await fetch(`${this.baseUrl}/v1/workspaces/${workspaceId}/blobs/${blobId}`, {
        signal: requestSignal,
        connectTimeout: 15_000,
        maxRedirections: 0,
        headers: {
          accept: 'application/octet-stream',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
      })
      requestSignal.throwIfAborted()
      if (!response.ok) {
        const value = await response.json() as ApiErrorBody
        if (response.status === 401) await this.onAuthenticationRejected?.()
        throw new SelfHostedApiError(value, response.status)
      }
      return new Uint8Array(await response.arrayBuffer())
    }, signal, 120_000)
  }

  private bootstrap(
    workspaceId: string,
    expectedSyncEpoch: string,
    bootstrapId?: string,
    afterObjectId?: string,
    limit = 200,
  ) {
    const query = new URLSearchParams({ expectedSyncEpoch, limit: String(limit) })
    if (bootstrapId) query.set('bootstrapId', bootstrapId)
    if (afterObjectId) query.set('afterObjectId', afterObjectId)
    return this.request<SyncBootstrapPage>(`/v1/workspaces/${workspaceId}/sync/bootstrap?${query}`)
  }

  async withBootstrapSnapshot<T>(
    workspaceId: string,
    expectedSyncEpoch: string,
    operation: (readPage: (bootstrapId?: string, afterObjectId?: string, limit?: number) => Promise<SyncBootstrapPage>) => Promise<T>,
  ): Promise<T> {
    const supportsRelease = this.bootstrapReleaseSupported
      ?? (await this.capabilities()).features.bootstrapRelease === true
    let snapshotId: string | undefined
    const readPage = async (bootstrapId?: string, afterObjectId?: string, limit?: number) => {
      if (bootstrapId !== snapshotId) throw new Error('bootstrap_snapshot_mismatch')
      let page: SyncBootstrapPage
      try {
        page = await this.bootstrap(workspaceId, expectedSyncEpoch, bootstrapId, afterObjectId, limit)
      } catch (error) {
        if (error instanceof SelfHostedApiError && error.body.code === 'bootstrap_capacity_exceeded') {
          throw new Error('SELF_HOSTED_BOOTSTRAP_CAPACITY_EXCEEDED')
        }
        throw error
      }
      if (snapshotId && page.bootstrapId !== snapshotId) throw new Error('bootstrap_snapshot_mismatch')
      snapshotId = page.bootstrapId
      if (page.syncEpoch !== expectedSyncEpoch) throw new Error('bootstrap_epoch_mismatch')
      return page
    }
    try {
      return await operation(readPage)
    } finally {
      if (supportsRelease && snapshotId) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5_000)
        try {
          await this.request<null>(`/v1/workspaces/${workspaceId}/sync/bootstrap/${encodeURIComponent(snapshotId)}?expectedSyncEpoch=${encodeURIComponent(expectedSyncEpoch)}`, {
            method: 'DELETE', signal: controller.signal,
          })
        } catch (error) {
          console.warn('[self-hosted-sync] Bootstrap snapshot release failed', {
            workspaceId, snapshotId, code: error instanceof SelfHostedApiError ? error.body.code : 'release_failed',
          })
        } finally { clearTimeout(timeout) }
      }
    }
  }

  documentUpdates(
    workspaceId: string,
    documentId: string,
    after: string,
    expectedSyncEpoch: string,
    limit = 500,
  ) {
    const query = new URLSearchParams({ after, expectedSyncEpoch, limit: String(limit) })
    return this.request<{
      checkpoint?: {
        objectId: string
        documentSequence: string
        checkpointId: string
        keyVersion: number
        ciphertext: string
        ciphertextHash: string
      } | null
      updates: Array<{
        workspaceId: string
        documentId: string
        documentSequence: string
        updateId: string
        eventSequence: string
        sourceDeviceId: string
        keyVersion: number
        ciphertext: string
        ciphertextHash: string
        createdAt: string
      }>
      nextDocumentSequence: string
      hasMore: boolean
      syncEpoch: string
    }>(`/v1/workspaces/${workspaceId}/documents/${encodeURIComponent(documentId)}/updates?${query}`)
  }

  async request<T>(path: string, options: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
    signal?: AbortSignal
  } = {}): Promise<T> {
    return boundedRequest(async signal => {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        signal,
        connectTimeout: 15_000,
        maxRedirections: 0,
        headers: {
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      signal.throwIfAborted()
      if (response.status === 401) await this.onAuthenticationRejected?.()
      let value: unknown = null
      if (response.status !== 204) {
        const content = await response.text()
        try { value = JSON.parse(content.replace(/^\uFEFF/, '')) as unknown }
        catch {
          throw new SelfHostedApiError({ code: 'invalid_response',
            message: `${response.status === 401 ? 'SELF_HOSTED_API_AUTH_REQUIRED' : 'SELF_HOSTED_API_INVALID_RESPONSE'}: HTTP ${response.status} ${path.split('?')[0]}`,
            requestId: response.headers.get('x-request-id') ?? '',
            retryable: response.ok || response.status >= 500 }, response.status)
        }
      }
      if (!response.ok) {
        const body = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Partial<ApiErrorBody>
        throw new SelfHostedApiError({
          code: body.code ?? 'request_failed',
          message: body.message ?? `服务器请求失败 (${response.status})`,
          requestId: body.requestId ?? '',
          retryable: body.retryable ?? response.status >= 500,
          ...(body.details === undefined ? {} : { details: body.details }),
        }, response.status)
      }
      return value as T
    }, options.signal)
  }
}
