import { Tool } from '../types'
import { noteTools } from './note-tools'
import { chatTools } from './chat-tools'
import { tagTools } from './tag-tools'
import { markTools } from './mark-tools'
import { folderTools } from './folder-tools'
import { systemTools } from './system-tools'

export const allTools: Tool[] = [
  ...noteTools,
  ...chatTools,
  ...tagTools,
  ...markTools,
  ...folderTools,
  ...systemTools,
]

/**
 * 将 MCP 工具转换为 Agent 工具格式
 * @param serverId MCP 服务器 ID
 * @param tool MCP 工具定义
 * @returns Agent 工具
 */
function convertMcpToolToAgentTool(serverId: string, tool: any): Tool {
  // 解析参数
  const parameters = Object.entries(tool.inputSchema?.properties || {}).map(([name, schema]: [string, any]) => ({
    name,
    type: mapJsonSchemaTypeToToolType(schema.type),
    description: schema.description || name,
    required: tool.inputSchema?.required?.includes(name) || false,
  }))

  // 增强工具描述，让 AI 更容易理解工具的用途
  const enhancedDescription = tool.description || tool.name

  return {
    name: `${serverId}__${tool.name}`,
    description: enhancedDescription,
    parameters,
    requiresConfirmation: false,
    category: 'mcp',
    execute: async (params: Record<string, any>) => {
      try {
        const { callTool } = await import('@/lib/mcp/tools')
        const result = await callTool(serverId, tool.name, params)

        if (result.isError) {
          return {
            success: false,
            error: result.content.map((c: any) => c.text).join('\n'),
          }
        }

        return {
          success: true,
          data: result.content,
          message: result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'),
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/**
 * 映射 JSON Schema 类型到工具参数类型
 */
function mapJsonSchemaTypeToToolType(jsonType: string): Tool['parameters'][0]['type'] {
  const typeMap: Record<string, Tool['parameters'][0]['type']> = {
    string: 'string',
    number: 'number',
    integer: 'number',
    boolean: 'boolean',
    array: 'array',
    object: 'object',
  }
  return typeMap[jsonType] || 'string'
}

/**
 * 获取所有工具，包括 MCP 工具（如果有选中的服务器）
 */
export function getAllTools(): Tool[] {
  const tools = [...allTools]

  // 动态添加 MCP 工具
  // 注意：由于循环依赖问题，这里无法直接使用 import
  // MCP 工具将在运行时通过动态加载方式添加
  // 这里返回基础工具列表
  return tools
}

// MCP 工具缓存
let mcpToolsCache: Tool[] = []
let mcpToolsLoaded = false

/**
 * 获取所有工具，包括 MCP 工具（异步版本）
 * 此函数用于需要加载 MCP 工具的场景
 */
export async function getAllToolsAsync(): Promise<Tool[]> {
  const tools = [...allTools]

  // 动态添加 MCP 工具
  try {
    const { useMcpStore } = await import('@/stores/mcp')
    const { mcpServerManager } = await import('@/lib/mcp/server-manager')

    const mcpStore = useMcpStore.getState()

    if (mcpStore.selectedServerIds.length === 0) {
      mcpToolsLoaded = true
      return tools
    }

    for (const serverId of mcpStore.selectedServerIds) {
      const mcpTools = mcpServerManager.getServerTools(serverId)

      for (const mcpTool of mcpTools) {
        const agentTool = convertMcpToolToAgentTool(serverId, mcpTool)
        tools.push(agentTool)
        mcpToolsCache.push(agentTool)
      }
    }
    mcpToolsLoaded = true
  } catch (error) {
    console.error('[Agent MCP] Failed to load MCP tools:', error)
  }

  return tools
}

/**
 * 获取工具（包括已加载的 MCP 工具）
 */
export function getAllToolsSync(): Tool[] {
  if (mcpToolsLoaded) {
    return [...allTools, ...mcpToolsCache]
  }
  return allTools
}

/**
 * 重新加载 MCP 工具
 */
export async function reloadMcpTools(): Promise<void> {
  mcpToolsCache = []
  mcpToolsLoaded = false
  await getAllToolsAsync()
}

export function getToolByName(name: string): Tool | undefined {
  return getAllToolsSync().find(tool => tool.name === name)
}

export function getToolsByCategory(category: Tool['category']): Tool[] {
  return allTools.filter(tool => tool.category === category)
}

export function getToolDescriptions(): string {
  return getAllToolsSync().map(tool => {
    const params = tool.parameters.map(p =>
      `  - ${p.name} (${p.type}${p.required ? ', required' : ', optional'}): ${p.description}`
    ).join('\n')

    return `### ${tool.name}
${tool.description}
Category: ${tool.category}
Requires Confirmation: ${tool.requiresConfirmation ? 'Yes' : 'No'}
Parameters:
${params || '  None'}
`
  }).join('\n\n')
}

export * from './note-tools'
export * from './chat-tools'
export * from './tag-tools'
export * from './mark-tools'
export * from './folder-tools'
export * from './system-tools'
