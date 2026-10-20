export const SELF_HOSTED_PROTOCOL_VERSION = 1 as const

export type WorkspaceType = 'account-data' | 'library'
export type WorkspaceRole = 'owner' | 'viewer' | 'editor' | 'manager'
export type WorkspaceCapability =
  | 'content.read' | 'content.create' | 'content.update' | 'content.delete'
  | 'history.view' | 'history.restore'
  | 'member.invite' | 'member.update' | 'member.remove'
  | 'workspace.rename' | 'workspace.delete'

export type SyncObjectKind =
  | 'note' | 'folder' | 'asset' | 'canvas' | 'tag' | 'mark'
  | 'conversation' | 'message' | 'memory' | 'setting'
  | 'yjs-checkpoint' | 'yjs-update'

export interface ServerCapabilities {
  service: 'note-gen-server'
  instanceId: string
  syncEpoch: string
  serverName: string
  serverVersion: string
  publicBaseUrl: string
  protocol: { minimum: number; maximum: number }
  features: Record<string, boolean>
  web: { accountUrl: string; deviceAuthorizationUrl: string }
}

export interface ClientSession {
  accountId: string
  deviceId: string
  accessToken: string
  refreshToken: string
  accessTokenExpiresIn: number
}

export interface WorkspaceSummary {
  id: string
  ownerAccountId: string
  type: WorkspaceType
  owner: boolean
  role: WorkspaceRole
  capabilities: WorkspaceCapability[]
  nameCiphertext: string
  latestSequence: string
  latestKeyVersion: number
  hasDeviceEnvelope: boolean
  encryptionMode: 'managed' | 'e2ee'
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface WorkspaceMember {
  accountId: string
  login: string
  role: WorkspaceRole
  capabilities: WorkspaceCapability[]
  joinedAt: string | null
  updatedAt: string | null
}

export interface WorkspaceInvitation {
  id: string
  workspaceId: string
  kind: 'account' | 'link'
  inviteeAccountId: string | null
  tokenHint: string | null
  role: Exclude<WorkspaceRole, 'owner'>
  capabilities: WorkspaceCapability[]
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expiresAt: string
  createdAt: string
  inviteeLogin?: string
  inviterLogin?: string
  workspaceNameCiphertext?: string
  token?: string
}

export interface SyncSession {
  protocol: { requestedVersion: number; selectedVersion: 1; compatible: boolean }
  workspace: {
    id: string
    type: WorkspaceType
    role: WorkspaceRole
    owner: boolean
    capabilities: WorkspaceCapability[]
  }
  cursor: {
    supplied: string
    state: 'valid' | 'ahead' | 'expired'
    acknowledged: string
    oldestAvailableSequence: string | null
  }
  latestSequence: string
  bootstrap: {
    required: boolean
    reason: 'cursor_ahead' | 'cursor_expired' | 'device_uninitialized' | 'lag_too_large' | null
  }
  limits: {
    maxCommandsPerBatch: number
    maxEventsPerPage: number
    maxBootstrapObjectsPerPage: number
    maxDocumentUpdatesPerPage: number
    maxObjectBytes: number
  }
  keyVersions: Array<{ keyVersion: number; createdAt: string }>
  syncEpoch: string
  websocketUrl: string
}

export interface SyncEvent {
  eventId: string
  sequence: string
  commandId: string
  sourceDeviceId: string
  type: 'object.upserted' | 'object.deleted' | 'document.updated'
    | 'document.checkpointed' | 'conflict.created' | 'conflict.resolved'
  objectId: string | null
  documentId: string | null
  documentSequence: string | null
  keyVersion: number | null
  ciphertext: string | null
  ciphertextHash: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface SyncEventsPage {
  events: SyncEvent[]
  nextCursor: string
  latestSequence: string
  hasMore: boolean
  syncEpoch: string
}

export interface SyncBootstrapPage {
  bootstrapId: string
  snapshotSequence: string
  objects: Array<{
    objectId: string
    kind: SyncObjectKind
    parentObjectId: string | null
    nameCiphertext: string | null
    currentRevision: string
    ciphertext: string
    ciphertextHash: string
    keyVersion: number
    blobRefs: string[]
    deletedAt: string | null
    document: {
      documentId: string
      latestDocumentSequence: string
      checkpointDocumentSequence: string
      checkpointId: string | null
      checkpointKeyVersion: number | null
      checkpointCiphertext: string | null
      checkpointCiphertextHash: string | null
      materializedRevision: string | null
    } | null
  }>
  conflicts: Array<Record<string, unknown>>
  nextObjectId: string | null
  hasMore: boolean
  syncEpoch: string
}

export interface SyncCommandResult {
  commandId: string
  status: 'applied' | 'conflict' | 'rejected'
  duplicate: boolean
  sequence?: string
  revision?: string
  documentSequence?: string
  conflictId?: string
  code?: string
  retryable?: boolean
  details?: Record<string, unknown>
}

export interface ApiErrorBody {
  code: string
  message: string
  requestId: string
  retryable: boolean
  details?: Record<string, unknown>
}
