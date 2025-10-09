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
  
  // 元数据
  createdAt: number
  lastConnected?: number
}

// MCP 工具定义
export interface MCPTool {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, any>
    required?: string[]
  }
}

// MCP 资源定义
export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

// JSON-RPC 请求
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: any
}

// JSON-RPC 响应
export interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

// MCP 初始化结果
export interface InitializeResult {
  protocolVersion: string
  capabilities: {
    tools?: Record<string, any>
    resources?: Record<string, any>
    prompts?: Record<string, any>
  }
  serverInfo: {
    name: string
    version: string
  }
}

// 工具调用结果
export interface CallToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
}

// 服务器状态
export type ServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// 服务器运行时状态
export interface MCPServerState {
  id: string
  status: ServerStatus
  tools: MCPTool[]
  resources: MCPResource[]
  error?: string
  connectedAt?: number
}
