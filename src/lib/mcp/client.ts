import { invoke } from '@tauri-apps/api/core'
import type {
  MCPServerConfig,
  JSONRPCRequest,
  JSONRPCResponse,
  InitializeResult,
  MCPTool,
  MCPResource,
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
  
  constructor(config: MCPServerConfig) {
    this.config = config
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
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'note-gen',
        version: '1.0.0',
      },
    })
    
    this.isInitialized = true
    return response as InitializeResult
  }
  
  /**
   * 列出可用工具
   */
  async listTools(): Promise<MCPTool[]> {
    // HTTP 服务器可能不需要初始化
    if (this.config.type === 'stdio' && !this.isInitialized) {
      await this.initialize()
    }
    
    // 尝试不同的方法名格式
    try {
      const response = await this.sendRequest('tools/list', {})
      return response.tools || []
    } catch {
      // 如果 tools/list 不支持，尝试 listTools
      try {
        const response = await this.sendRequest('listTools', {})
        return response.tools || []
      } catch {
        // 如果都不支持，返回空数组
        console.warn('Server does not support tool listing')
        return []
      }
    }
  }
  
  /**
   * 调用工具
   */
  async callTool(name: string, args: any = {}): Promise<CallToolResult> {
    if (!this.isInitialized) {
      await this.initialize()
    }
    
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    })
    
    return response as CallToolResult
  }
  
  /**
   * 列出资源
   */
  async listResources(): Promise<MCPResource[]> {
    if (!this.isInitialized) {
      await this.initialize()
    }
    
    const response = await this.sendRequest('resources/list', {})
    return response.resources || []
  }
  
  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize()
    }
    
    const response = await this.sendRequest('resources/read', { uri })
    return response.contents?.[0]?.text || ''
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
  }
  
  /**
   * 发送 JSON-RPC 请求
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    }
    
    if (this.config.type === 'stdio') {
      return this.sendStdioRequest(request)
    } else {
      return this.sendHttpRequest(request)
    }
  }
  
  /**
   * 发送 stdio 请求
   */
  private async sendStdioRequest(request: JSONRPCRequest): Promise<any> {
    try {
      const responseStr = await invoke<string>('send_mcp_message', {
        serverId: this.config.id,
        message: JSON.stringify(request),
      })
      
      const response: JSONRPCResponse = JSON.parse(responseStr)
      
      if (response.error) {
        throw new Error(response.error.message)
      }
      
      return response.result
    } catch (error) {
      throw new Error(`Stdio request failed: ${error}`)
    }
  }
  
  /**
   * 发送 HTTP 请求
   */
  private async sendHttpRequest(request: JSONRPCRequest): Promise<any> {
    if (!this.config.url) {
      throw new Error('HTTP server URL is required')
    }
    
    try {
      // 解析自定义 headers
      let customHeaders: Record<string, string> = {}
      if (this.config.headers) {
        try {
          customHeaders = typeof this.config.headers === 'string' 
            ? JSON.parse(this.config.headers) 
            : this.config.headers
        } catch (e) {
          console.warn('Failed to parse custom headers:', e)
        }
      }
      
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          ...customHeaders,
        },
        body: JSON.stringify(request),
      })
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText)
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }
      
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
        let jsonData = ''
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            jsonData = line.substring(6) // 移除 "data: " 前缀
            break
          }
        }
        
        if (jsonData) {
          const jsonResponse: JSONRPCResponse = JSON.parse(jsonData)
          if (jsonResponse.error) {
            throw new Error(jsonResponse.error.message)
          }
          return jsonResponse.result
        }
        throw new Error('Invalid SSE response format')
      }
      
      // 标准 JSON 响应
      const jsonResponse: JSONRPCResponse = await response.json()
      
      if (jsonResponse.error) {
        throw new Error(jsonResponse.error.message)
      }
      
      return jsonResponse.result
    } catch (error) {
      // 静默处理错误，不在控制台输出
      throw error
    }
  }
}
