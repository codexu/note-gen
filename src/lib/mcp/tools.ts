import { mcpServerManager } from './server-manager'
import { useMcpStore } from '@/stores/mcp'
import type { MCPTool, CallToolResult } from './types'

/**
 * 获取所有选中服务器的工具
 */
export function getSelectedServerTools(): Array<{
  serverId: string
  serverName: string
  tool: MCPTool
}> {
  const store = useMcpStore.getState()
  const result: Array<{ serverId: string; serverName: string; tool: MCPTool }> = []
  
  for (const server of store.servers) {
    if (store.selectedServerIds.includes(server.id)) {
      const tools = mcpServerManager.getServerTools(server.id)
      for (const tool of tools) {
        result.push({
          serverId: server.id,
          serverName: server.name,
          tool,
        })
      }
    }
  }
  
  return result
}

/**
 * 获取所有选中服务器的工具，转换为 OpenAI Function Calling 格式
 */
export function getOpenAIFunctions(selectedServerIds: string[]): any[] {
  const functions: any[] = []
  
  for (const serverId of selectedServerIds) {
    const tools = mcpServerManager.getServerTools(serverId)
    
    for (const tool of tools) {
      // 转换为 OpenAI Function Calling 格式
      functions.push({
        type: 'function',
        function: {
          name: `${serverId}__${tool.name}`, // 使用服务器ID作为前缀避免冲突
          description: tool.description || tool.name,
          parameters: tool.inputSchema || {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      })
    }
  }
  
  return functions
}

/**
 * 搜索工具
 */
export function searchTools(query: string): Array<{
  serverId: string
  serverName: string
  tool: MCPTool
}> {
  const allTools = getSelectedServerTools()
  
  if (!query.trim()) {
    return allTools
  }
  
  const lowerQuery = query.toLowerCase()
  return allTools.filter(
    ({ tool }) =>
      tool.name.toLowerCase().includes(lowerQuery) ||
      tool.description?.toLowerCase().includes(lowerQuery)
  )
}

/**
 * 调用工具
 */
export async function callTool(
  serverId: string,
  toolName: string,
  args: any = {}
): Promise<CallToolResult> {
  return await mcpServerManager.callTool(serverId, toolName, args)
}

/**
 * 验证工具参数
 */
export function validateToolArgs(tool: MCPTool, args: any): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const required = tool.inputSchema.required || []
  
  // 检查必需参数
  for (const field of required) {
    if (!(field in args)) {
      errors.push(`Missing required parameter: ${field}`)
    }
  }
  
  // 检查参数类型（简单验证）
  const properties = tool.inputSchema.properties || {}
  for (const key of Object.keys(args)) {
    if (!(key in properties)) {
      errors.push(`Unknown parameter: ${key}`)
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * 格式化工具调用结果
 */
export function formatToolResult(result: CallToolResult): string {
  if (result.isError) {
    return `❌ Error: ${result.content[0]?.text || 'Unknown error'}`
  }
  
  const textContent = result.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')
  
  return textContent || 'Tool executed successfully'
}

/**
 * 将工具转换为 OpenAI Function Calling 格式
 */
export function toolToOpenAIFunction(tool: MCPTool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.inputSchema,
    },
  }
}

