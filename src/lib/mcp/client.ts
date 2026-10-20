import { invoke } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import type {
  MCPServerConfig,
  JSONRPCRequest,
  JSONRPCResponse,
  InitializeResult,
  MCPTool,
  MCPResource,
  MCPResourceTemplate,
  MCPReadResourceResult,
  CallToolResult,
} from './types'

/**
 * MCP 客户端
 * 支持 stdio 和 HTTP 两种传输协议
 */
export class MCPClient {
  private config: MCPServerConfig
  private requestId = 0
  private isInitialized = false
  private initializeResult?: InitializeResult
  private readonly defaultTimeout: number
  private sessionId?: string
  
  constructor(config: MCPServerConfig) {
    this.config = config
    this.defaultTimeout = config.timeout ?? 30_000
  }
  
  /**
   * 连接到 MCP 服务器
   */
  async connect(): Promise<void> {
    if (this.config.type === 'stdio') {
      await this.connectStdio()
    } else {
      await this.connectHttp()
    }
  }
  
  /**
   * 连接 stdio 服务器
   */
  private async connectStdio(): Promise<void> {
    try {
      await invoke('start_mcp_stdio_server', {
        serverId: this.config.id,
        command: this.config.command,
        args: this.config.args || [],
        env: this.config.env || {},
      })
    } catch (error) {
      throw new Error(`Failed to start stdio server: ${error}`)
    }
  }
  
  /**
   * 连接 HTTP 服务器
   */
  private async connectHttp(): Promise<void> {
    // HTTP 连接不需要特殊的启动过程
    // 只需要验证 URL 是否可访问
    if (!this.config.url) {
      throw new Error('HTTP server URL is required')
    }
  }
  
  /**
   * 初始化协议
   */
  async initialize(): Promise<InitializeResult> {
    if (this.initializeResult) return this.initializeResult

    const response = await this.sendRequest<InitializeResult>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'note-gen',
        version: '1.0.0',
      },
    })
    
    if (!response.protocolVersion) throw new Error('MCP server did not return a protocol version')
    this.initializeResult = response
    await this.sendNotification('notifications/initialized')
    this.isInitialized = true
    return response
  }
  
  /**
   * 列出可用工具
   */
  async listTools(): Promise<MCPTool[]> {
    const initialized = await this.initialize()
    if (!initialized.capabilities.tools) return []
    return this.collectPages<MCPTool>('tools/list', 'tools')
  }
  
  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<CallToolResult> {
    if (!this.isInitialized) {
      await this.initialize()
    }
    
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    }, signal)
    
    return response as CallToolResult
  }
  
  /**
   * 列出资源
   */
  async listResources(): Promise<MCPResource[]> {
    const initialized = await this.initialize()
    if (!initialized.capabilities.resources) return []
    return this.collectPages<MCPResource>('resources/list', 'resources')
  }
  
  /**
   * 读取资源
   */
  async listResourceTemplates(): Promise<MCPResourceTemplate[]> {
    const initialized = await this.initialize()
    if (!initialized.capabilities.resources) return []
    return this.collectPages<MCPResourceTemplate>('resources/templates/list', 'resourceTemplates')
  }

  async readResource(uri: string): Promise<MCPReadResourceResult> {
    if (!this.isInitialized) {
      await this.initialize()
    }
    
    return await this.sendRequest<MCPReadResourceResult>('resources/read', { uri })
  }
  
  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.config.type === 'stdio') {
      try {
        await invoke('stop_mcp_server', { serverId: this.config.id })
      } catch {
        // 静默处理错误
      }
    }
    this.isInitialized = false
    this.initializeResult = undefined
    this.sessionId = undefined
  }
  
  /**
   * 发送 JSON-RPC 请求
   */
  private async sendRequest<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    }
    
    if (this.config.type === 'stdio') {
      return this.withTimeout(this.sendStdioRequest<T>(request), signal)
    } else {
      return this.withTimeout(this.sendHttpRequest<T>(request, signal), signal)
    }
  }

  private async collectPages<T>(method: string, field: 'tools' | 'resources' | 'resourceTemplates'): Promise<T[]> {
    const items: T[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined

    for (let page = 0; page < 1_000; page += 1) {
      const response = await this.sendRequest<Partial<Record<'tools' | 'resources' | 'resourceTemplates', T[]>> & { nextCursor?: string }>(
        method,
        cursor ? { cursor } : {}
      )
      items.push(...(response[field] || []))
      if (!response.nextCursor) return items
      if (cursors.has(response.nextCursor)) throw new Error(`MCP ${method} returned a duplicate cursor`)
      cursors.add(response.nextCursor)
      cursor = response.nextCursor
    }
    throw new Error(`MCP ${method} exceeded the pagination limit`)
  }

  private async sendNotification(method: string, params: Record<string, unknown> = {}): Promise<void> {
    const notification = { jsonrpc: '2.0' as const, method, params }
    if (this.config.type === 'stdio') {
      await invoke('send_mcp_notification', {
        serverId: this.config.id,
        message: JSON.stringify(notification),
      })
      return
    }
    if (!this.config.url) throw new Error('HTTP server URL is required')
    const response = await tauriFetch(this.config.url, {
      method: 'POST',
      headers: this.getHttpHeaders(),
      body: JSON.stringify(notification),
    })
    if (!response.ok) throw new Error(`MCP notification failed with HTTP ${response.status}`)
  }

  private async withTimeout<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
    return await new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(`MCP request timed out after ${this.defaultTimeout}ms`)), this.defaultTimeout)
      const onAbort = () => reject(new DOMException('Request aborted', 'AbortError'))
      signal?.addEventListener('abort', onAbort, { once: true })
      promise.then(resolve, reject).finally(() => {
        window.clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
      })
    })
  }
  
  /**
   * 发送 stdio 请求
   */
  private async sendStdioRequest<T>(request: JSONRPCRequest): Promise<T> {
    try {
      const responseStr = await invoke<string>('send_mcp_message', {
        serverId: this.config.id,
        message: JSON.stringify(request),
        timeoutMs: this.defaultTimeout,
      })
      
      const response: JSONRPCResponse = JSON.parse(responseStr)
      
      if (response.error) {
        throw new Error(response.error.message)
      }
      
      return response.result as T
    } catch (error) {
      throw new Error(`Stdio request failed: ${error}`)
    }
  }
  
  /**
   * 发送 HTTP 请求
   */
  private getHttpHeaders() {
    let customHeaders: Record<string, string> = {}
    if (this.config.headers) customHeaders = this.config.headers
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      ...(this.initializeResult?.protocolVersion ? { 'MCP-Protocol-Version': this.initializeResult.protocolVersion } : {}),
      ...customHeaders,
    }
  }

  private async sendHttpRequest<T>(request: JSONRPCRequest, signal?: AbortSignal): Promise<T> {
    if (!this.config.url) {
      throw new Error('HTTP server URL is required')
    }
    
    try {
      const response = await tauriFetch(this.config.url, {
        method: 'POST',
        headers: this.getHttpHeaders(),
        body: JSON.stringify(request),
        signal,
      })
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText)
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const returnedSessionId = response.headers.get('mcp-session-id')
      if (returnedSessionId) this.sessionId = returnedSessionId
      
      // 检查响应的 Content-Type
      const contentType = response.headers.get('content-type')
      
      // 如果是 SSE 流式响应，需要特殊处理
      if (contentType?.includes('text/event-stream')) {
        // 对于流式响应，读取第一个事件
        const text = await response.text()
        
        // 解析 SSE 格式，支持多种格式：
        // 1. event: message\ndata: {...}\n\n
        // 2. data: {...}\n\n
        const lines = text.split('\n')
        let matchedResponse: JSONRPCResponse | undefined
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const candidate = JSON.parse(line.substring(6)) as JSONRPCResponse
            if (String(candidate.id) === String(request.id)) {
              matchedResponse = candidate
              break
            }
          }
        }

        if (matchedResponse) {
          if (matchedResponse.error) {
            throw new Error(matchedResponse.error.message)
          }
          return matchedResponse.result as T
        }
        throw new Error('Invalid SSE response format')
      }
      
      // 标准 JSON 响应
      const jsonResponse: JSONRPCResponse = await response.json()
      
      if (jsonResponse.error) {
        throw new Error(jsonResponse.error.message)
      }
      
      return jsonResponse.result as T
    } catch (error) {
      // 静默处理错误，不在控制台输出
      throw error
    }
  }
}
