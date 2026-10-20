import { MCPClient } from './client'
import { listen } from '@tauri-apps/api/event'
import { useMcpStore } from '@/stores/mcp'
import type {
  MCPServerConfig,
  MCPTool,
  MCPResource,
  MCPResourceTemplate,
  MCPReadResourceResult,
  CallToolResult,
} from './types'

interface MCPBatchTestResult {
  total: number
  success: number
  failed: number
  results: Array<{
    serverId: string
    success: boolean
  }>
}

export interface MCPConnectionTestResult {
  success: boolean
  error?: string
}

function sanitizeMcpError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)

  return message
    .replace(/([?&][^=&\s]*(?:key|token|secret|password)=)[^&\s)]+/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)[\w.-]+/gi, '$1[REDACTED]')
}

/**
 * MCP 服务器管理器
 * 管理多个 MCP 服务器的连接和工具调用
 */
export class MCPServerManager {
  private static instance: MCPServerManager
  private clients: Map<string, MCPClient> = new Map()
  private eventSetup?: Promise<void>
  
  private constructor() {}
  
  static getInstance(): MCPServerManager {
    if (!MCPServerManager.instance) {
      MCPServerManager.instance = new MCPServerManager()
    }
    return MCPServerManager.instance
  }

  private ensureEventListeners(): Promise<void> {
    if (this.eventSetup) return this.eventSetup
    this.eventSetup = Promise.all([
      listen<{ serverId: string; message?: { method?: string } }>('mcp://notification', event => {
        if (event.payload.message?.method === 'notifications/tools/list_changed') {
          void this.refreshServerTools(event.payload.serverId)
        }
      }),
      listen<{ serverId: string; error?: string }>('mcp://closed', event => {
        if (!this.clients.has(event.payload.serverId)) return
        this.clients.delete(event.payload.serverId)
        useMcpStore.getState().setServerState(event.payload.serverId, {
          id: event.payload.serverId,
          status: 'error',
          tools: [],
          resources: [],
          error: event.payload.error || 'MCP connection closed',
        })
      }),
    ]).then(() => undefined)
    return this.eventSetup
  }

  private async refreshServerTools(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    const state = useMcpStore.getState().getServerState(serverId)
    if (!client || state?.status !== 'connected') return
    try {
      const tools = await client.listTools()
      useMcpStore.getState().setServerState(serverId, { ...state, tools })
    } catch (error) {
      console.error(`Failed to refresh MCP tools for ${serverId}:`, sanitizeMcpError(error))
    }
  }
  
  /**
   * 连接到服务器
   */
  async connectServer(config: MCPServerConfig): Promise<void> {
    await this.ensureEventListeners()
    const store = useMcpStore.getState()

    if (this.clients.has(config.id)) {
      await this.disconnectServer(config.id)
    }
    
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
      const initialized = await client.initialize()
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
        protocolVersion: initialized.protocolVersion,
        capabilities: initialized.capabilities,
        instructions: initialized.instructions,
      })
      
      // 更新最后连接时间
      store.updateServer(config.id, { lastConnected: Date.now() })
    } catch (error) {
      const sanitizedError = sanitizeMcpError(error)
      // 静默处理错误，设置错误状态
      store.setServerState(config.id, {
        id: config.id,
        status: 'error',
        tools: [],
        resources: [],
        error: sanitizedError,
      })
      
      throw new Error(sanitizedError)
    }
  }
  
  /**
   * 断开服务器连接
   */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client) {
      this.clients.delete(serverId)
      await client.disconnect()
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

  async connectEnabledServers(servers: MCPServerConfig[]): Promise<void> {
    for (const server of servers) {
      if (!server.enabled) {
        continue
      }

      try {
        await this.connectServer(server)
      } catch (error) {
        console.error(`Failed to connect MCP server ${server.name}:`, sanitizeMcpError(error))
      }
    }
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
    args: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<CallToolResult> {
    const client = this.clients.get(serverId)
    if (!client) {
      throw new Error(`Server ${serverId} is not connected`)
    }
    
    return await client.callTool(toolName, args, signal)
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
  async listResourceTemplates(serverId: string): Promise<MCPResourceTemplate[]> {
    const client = this.clients.get(serverId)
    if (!client) throw new Error(`Server ${serverId} is not connected`)
    return await client.listResourceTemplates()
  }

  async readResource(serverId: string, uri: string): Promise<MCPReadResourceResult> {
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
  async testConnectionDetailed(config: MCPServerConfig): Promise<MCPConnectionTestResult> {
    const testConfig: MCPServerConfig = {
      ...config,
      id: `mcp-test-${config.id}-${Date.now()}`,
    }
    const client = new MCPClient(testConfig)
    try {
      await client.connect()
      const initialized = await client.initialize()
      if (initialized.capabilities.tools) await client.listTools()
      if (initialized.capabilities.resources) await client.listResources()
      return { success: true }
    } catch (error) {
      const sanitizedError = sanitizeMcpError(error)
      console.error('MCP connection test failed:', sanitizedError)
      return { success: false, error: sanitizedError }
    } finally {
      try {
        await client.disconnect()
      } catch {
        // The connection may have failed before a transport was created.
      }
    }
  }

  async testConnection(config: MCPServerConfig): Promise<boolean> {
    return (await this.testConnectionDetailed(config)).success
  }

  async testConnections(configs: MCPServerConfig[]): Promise<MCPBatchTestResult> {
    const results = await Promise.all(
      configs.map(async (config) => ({
        serverId: config.id,
        success: await this.testConnection(config),
      }))
    )

    const success = results.filter(result => result.success).length

    return {
      total: results.length,
      success,
      failed: results.length - success,
      results,
    }
  }
}

// 导出单例
export const mcpServerManager = MCPServerManager.getInstance()
