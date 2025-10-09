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
    
    // MCP 初始化成功
  } catch {
    // 静默处理初始化错误
  }
}

/**
 * 清理 MCP 资源
 * 在应用关闭时调用
 */
export async function cleanupMcp() {
  try {
    await mcpIntegration.cleanup()
    // MCP 清理成功
  } catch {
    // 静默处理清理错误
  }
}
