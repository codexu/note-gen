export interface LocalMcpConnection {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number
}

export interface LocalMcpStatus {
  enabled: boolean
  ready: boolean
  port: number
  serverError?: string | null
}

export interface LocalMcpConnectionSecret {
  connection: LocalMcpConnection
  token: string
}

export interface LocalMcpBridgeRequest {
  requestId: string
  connection: LocalMcpConnection
  toolName: string
  arguments: unknown
}

export interface LocalMcpBridgeError {
  code: string
  message: string
  data?: unknown
}

export interface LocalMcpToolResult {
  content: Array<{
    type: 'text'
    text: string
  }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}
