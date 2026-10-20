/**
 * MCP (Model Context Protocol) 类型定义
 */

// MCP 服务器配置类型
export type MCPServerType = 'stdio' | 'http'

// MCP 服务器配置
export interface MCPServerConfig {
  id: string
  name: string
  type: MCPServerType
  enabled: boolean
  
  // stdio 配置
  command?: string
  args?: string[]
  env?: Record<string, string>
  
  // HTTP 配置
  url?: string
  headers?: Record<string, string>
  timeout?: number
  trustToolAnnotations?: boolean
  
  // 元数据
  createdAt: number
  lastConnected?: number
}

// MCP 工具定义
export interface MCPJsonSchema {
  type?: string | string[]
  properties?: Record<string, MCPJsonSchema>
  required?: string[]
  items?: MCPJsonSchema
  additionalProperties?: boolean | MCPJsonSchema
  oneOf?: MCPJsonSchema[]
  anyOf?: MCPJsonSchema[]
  allOf?: MCPJsonSchema[]
  $ref?: string
  $defs?: Record<string, MCPJsonSchema>
  [key: string]: unknown
}

export interface MCPTool {
  name: string
  title?: string
  description?: string
  annotations?: MCPToolAnnotations
  inputSchema: MCPJsonSchema
  outputSchema?: MCPJsonSchema
  _meta?: Record<string, unknown>
}

export interface MCPToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

// MCP 资源定义
export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
  size?: number
  annotations?: Record<string, unknown>
}

export interface MCPResourceTemplate {
  uriTemplate: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export interface MCPResourceContents {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

export interface MCPReadResourceResult {
  contents: MCPResourceContents[]
  _meta?: Record<string, unknown>
}

// JSON-RPC 请求
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

// JSON-RPC 响应
export interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

// MCP 初始化结果
export interface InitializeResult {
  protocolVersion: string
  capabilities: {
    tools?: { listChanged?: boolean }
    resources?: { subscribe?: boolean; listChanged?: boolean }
    prompts?: { listChanged?: boolean }
  }
  serverInfo: {
    name: string
    version: string
  }
  instructions?: string
}

export interface MCPTextContent {
  type: 'text'
  text: string
  annotations?: Record<string, unknown>
}

export interface MCPBinaryContent {
  type: 'image' | 'audio'
  data: string
  mimeType: string
  annotations?: Record<string, unknown>
}

export interface MCPEmbeddedResourceContent {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    text?: string
    blob?: string
  }
  annotations?: Record<string, unknown>
}

export interface MCPResourceLinkContent {
  type: 'resource_link'
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  annotations?: Record<string, unknown>
}

// 工具调用结果
export interface CallToolResult {
  content: Array<MCPTextContent | MCPBinaryContent | MCPEmbeddedResourceContent | MCPResourceLinkContent>
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

// 服务器状态
export type ServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'needs_auth'

// 服务器运行时状态
export interface MCPServerState {
  id: string
  status: ServerStatus
  tools: MCPTool[]
  resources: MCPResource[]
  error?: string
  connectedAt?: number
  protocolVersion?: string
  capabilities?: InitializeResult['capabilities']
  instructions?: string
}
