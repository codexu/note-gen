import { MCPClient } from './client'
import { useMcpStore } from '@/stores/mcp'
import type {
  MCPServerConfig,
  MCPTool,
  MCPResource,
  CallToolResult,
} from './types'

/**
 * MCP 服务器管理器
 * 管理多个 MCP 服务器的连接和工具调用
 */
export class MCPServerManager {
  private static instance: MCPServerManager
  private clients: Map<string, MCPClient> = new Map()
  
  private constructor() {}
  
  static getInstance(): MCPServerManager {
    if (!MCPServerManager.instance) {
      MCPServerManager.instance = new MCPServerManager()
    }
    return MCPServerManager.instance
  }
  
  /**
   * 连接到服务器
   */
  async connectServer(config: MCPServerConfig): Promise<void> {
    const store = useMcpStore.getState()
    
    // 设置连接中状态
    store.setServerState(config.id, {
      id: config.id,
      status: 'connecting',
      tools: [],
      resources: [],
    })
    
    try {
      const client = new MCPClient(config)
      await client.connect()
      
      // 初始化并获取工具列表
      await client.initialize()
      const tools = await client.listTools()
      
      // 尝试获取资源列表（某些服务器可能不支持）
      let resources: MCPResource[] = []
      try {
        resources = await client.listResources()
      } catch {
        // 静默处理，某些服务器不支持 resources
      }
      
      this.clients.set(config.id, client)
      
      // 更新连接成功状态
      store.setServerState(config.id, {
        id: config.id,
        status: 'connected',
        tools,
        resources,
        connectedAt: Date.now(),
      })
      
      // 更新最后连接时间
      store.updateServer(config.id, { lastConnected: Date.now() })
      
      // 连接成功
    } catch (error) {
      // 静默处理错误，设置错误状态
      store.setServerState(config.id, {
        id: config.id,
        status: 'error',
        tools: [],
        resources: [],
        error: error instanceof Error ? error.message : String(error),
      })
      
      throw error
    }
  }
  
  /**
   * 断开服务器连接
   */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client) {
      await client.disconnect()
      this.clients.delete(serverId)
    }
    
    const store = useMcpStore.getState()
    store.setServerState(serverId, {
      id: serverId,
      status: 'disconnected',
      tools: [],
      resources: [],
    })
  }
  
  /**
   * 重新连接服务器
   */
  async reconnectServer(config: MCPServerConfig): Promise<void> {
    await this.disconnectServer(config.id)
    await this.connectServer(config)
  }
  
  /**
   * 获取服务器的所有工具
   */
  getServerTools(serverId: string): MCPTool[] {
    const store = useMcpStore.getState()
    const state = store.getServerState(serverId)
    return state?.tools || []
  }
  
  /**
   * 获取所有已连接服务器的工具
   */
  getAllTools(): Map<string, MCPTool[]> {
    const store = useMcpStore.getState()
    const toolsMap = new Map<string, MCPTool[]>()
    
    for (const server of store.servers) {
      if (server.enabled) {
        const state = store.getServerState(server.id)
        if (state?.status === 'connected') {
          toolsMap.set(server.id, state.tools)
        }
      }
    }
    
    return toolsMap
  }
  
  /**
   * 调用工具
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: any = {}
  ): Promise<CallToolResult> {
    const client = this.clients.get(serverId)
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`)
    }
    
    return await client.callTool(toolName, args)
  }
  
  /**
   * 获取服务器资源
   */
  getServerResources(serverId: string): MCPResource[] {
    const store = useMcpStore.getState()
    const state = store.getServerState(serverId)
    return state?.resources || []
  }
  
  /**
   * 读取资源
   */
  async readResource(serverId: string, uri: string): Promise<string> {
    const client = this.clients.get(serverId)
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`)
    }
    
    return await client.readResource(uri)
  }
  
  /**
   * 断开所有服务器
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.clients.keys()).map(id =>
      this.disconnectServer(id)
    )
    await Promise.all(promises)
  }
  
  /**
   * 测试服务器连接
   * 注意：测试时不会更新 store 中的服务器状态
   */
  async testConnection(config: MCPServerConfig): Promise<boolean> {
    try {
      if (config.type === 'http') {
        // 对于 HTTP 服务器，简单测试 URL 是否可访问
        if (!config.url) {
          throw new Error('HTTP server URL is required')
        }
        
        // 发送一个简单的 OPTIONS 请求来测试连接
        await fetch(config.url, {
          method: 'OPTIONS',
          headers: {
            'Accept': 'application/json, text/event-stream',
          },
        })
        
        // 只要服务器响应了（即使是错误），就认为连接成功
        return true
      } else {
        // 对于 stdio 服务器，需要实际启动和初始化
        const client = new MCPClient(config)
        try {
          await client.connect()
          await client.initialize()
          // 测试完成后立即断开连接并清理
          await client.disconnect()
          return true
        } catch (error) {
          console.error('测试连接失败:', error)
          // 确保清理临时客户端
          try {
            await client.disconnect()
          } catch {
            // 静默处理清理错误
          }
          throw error
        }
      }
    } catch {
      // 静默处理测试失败
      return false
    }
  }
}

// 导出单例
export const mcpServerManager = MCPServerManager.getInstance()
