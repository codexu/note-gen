import { mcpServerManager } from './server-manager'
import { useMcpStore } from '@/stores/mcp'
import { callTool } from './tools'
import type { CallToolResult } from './types'

/**
 * MCP 集成模块
 * 提供统一的 MCP 功能集成接口
 */
export class MCPIntegration {
  private static instance: MCPIntegration
  
  private constructor() {}
  
  static getInstance(): MCPIntegration {
    if (!MCPIntegration.instance) {
      MCPIntegration.instance = new MCPIntegration()
    }
    return MCPIntegration.instance
  }
  
  /**
   * 初始化 MCP
   * 连接所有启用的服务器
   */
  async initialize(): Promise<void> {
    const store = useMcpStore.getState()
    
    if (!store.enabled) {
      return
    }
    
    const enabledServers = store.servers.filter(s => s.enabled)
    
    for (const server of enabledServers) {
      try {
        await mcpServerManager.connectServer(server)
      } catch {
        // 静默处理连接错误
      }
    }
  }
  
  /**
   * 处理 AI 工具调用
   * 当 AI 决定调用工具时调用此方法
   */
  async handleToolCall(
    toolName: string,
    args: any
  ): Promise<{
    success: boolean
    result?: CallToolResult
    error?: string
  }> {
    const store = useMcpStore.getState()
    
    // 查找工具所属的服务器
    let targetServerId: string | null = null
    
    for (const serverId of store.selectedServerIds) {
      const tools = mcpServerManager.getServerTools(serverId)
      if (tools.some(t => t.name === toolName)) {
        targetServerId = serverId
        break
      }
    }
    
    if (!targetServerId) {
      return {
        success: false,
        error: `Tool ${toolName} not found in selected servers`,
      }
    }
    
    try {
      const result = await callTool(targetServerId, toolName, args)
      return {
        success: !result.isError,
        result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  
  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await mcpServerManager.disconnectAll()
  }
}

// 导出单例
export const mcpIntegration = MCPIntegration.getInstance()
