import { mcpIntegration } from './integration'
import { useMcpStore } from '@/stores/mcp'

/**
 * 初始化 MCP
 * 在应用启动时调用
 */
export async function initMcp() {
  try {
    // 加载 MCP 数据
    await useMcpStore.getState().initMcpData()
    
    // 初始化 MCP 集成（连接启用的服务器）
    await mcpIntegration.initialize()
    
    console.log('MCP initialized successfully')
  } catch (error) {
    console.error('Failed to initialize MCP:', error)
  }
}

/**
 * 清理 MCP 资源
 * 在应用关闭时调用
 */
export async function cleanupMcp() {
  try {
    await mcpIntegration.cleanup()
    console.log('MCP cleaned up successfully')
  } catch (error) {
    console.error('Failed to cleanup MCP:', error)
  }
}
