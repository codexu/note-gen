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
  readonly baseUrl: string

  constructor(
    serverUrl: string,
    private readonly accessToken?: string,
    private readonly onAuthenticationRejected?: () => Promise<void>,
  ) {
    this.baseUrl = normalizeServerUrl(serverUrl).url
  }

  capabilities() {
    return this.request<ServerCapabilities>('/v1/capabilities')
  }

  login(input: { login: string; password: string; totpCode?: string; deviceId: string; deviceName: string; platform: string; encryptionPublicKey?: string }) {
    return this.request<ClientSession>('/v1/auth/login', { method: 'POST', body: input })
  }

  refresh(refreshToken: string, deviceId: string, refreshRequestId: string) {
    return this.request<ClientSession>('/v1/auth/refresh', {
      method: 'POST', body: { refreshToken, deviceId, refreshRequestId },
    })
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
  }) {
    return this.request<{
      alreadyExists: boolean
      resumed: boolean
      blobId: string
      uploadId: string | null
      partBytes: number
      uploadedParts: Array<{ partNumber: number; etag: string; size: string }>
      expiresAt: string | null
    }>(`/v1/workspaces/${workspaceId}/blobs/uploads`, { method: 'POST', body: input })
  }

  async uploadBlobPart(workspaceId: string, uploadId: string, partNumber: number, bytes: Uint8Array) {
    const response = await fetch(
      `${this.baseUrl}/v1/workspaces/${workspaceId}/blobs/uploads/${uploadId}/parts/${partNumber}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: bytes,
      }
    )
    const value = await response.json() as { partNumber: number; etag: string; receivedSize: string } | ApiErrorBody
    if (!response.ok) {
      if (response.status === 401) await this.onAuthenticationRejected?.()
      throw new SelfHostedApiError(value as ApiErrorBody, response.status)
    }
    return value as { partNumber: number; etag: string; receivedSize: string }
  }

  completeBlobUpload(workspaceId: string, uploadId: string, expectedSyncEpoch: string) {
    return this.request<{ blobId: string; size: string; ciphertextHash: string }>(
      `/v1/workspaces/${workspaceId}/blobs/uploads/${uploadId}/complete`,
      { method: 'POST', body: { expectedSyncEpoch } },
    )
  }

  async downloadBlob(workspaceId: string, blobId: string) {
    const response = await fetch(`${this.baseUrl}/v1/workspaces/${workspaceId}/blobs/${blobId}`, {
      headers: {
        accept: 'application/octet-stream',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
    })
    if (!response.ok) {
      const value = await response.json() as ApiErrorBody
      if (response.status === 401) await this.onAuthenticationRejected?.()
      throw new SelfHostedApiError(value, response.status)
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  bootstrap(
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
  } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
    const value: unknown = response.status === 204 ? null : await response.json()
    if (!response.ok) {
      const body = value as Partial<ApiErrorBody>
      if (response.status === 401) await this.onAuthenticationRejected?.()
      throw new SelfHostedApiError({
        code: body.code ?? 'request_failed',
        message: body.message ?? `服务器请求失败 (${response.status})`,
        requestId: body.requestId ?? '',
        retryable: body.retryable ?? response.status >= 500,
        ...(body.details === undefined ? {} : { details: body.details }),
      }, response.status)
    }
    return value as T
  }
}
