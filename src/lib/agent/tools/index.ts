import { Tool } from '../types'
import { noteTools } from './note-tools'
import { chatTools } from './chat-tools'
import { tagTools } from './tag-tools'
import { markTools } from './mark-tools'
import { folderTools } from './folder-tools'
import { systemTools } from './system-tools'
import { memoryTools } from './memory-tools'
import { editorTools } from './editor-tools'

export const allTools: Tool[] = [
  ...noteTools,
  ...chatTools,
  ...tagTools,
  ...markTools,
  ...folderTools,
  ...systemTools,
  ...memoryTools,
  ...editorTools,
]

/**
 * Convert MCP tools to Agent tool format
 * @param serverId MCP server ID
 * @param tool MCP tool definition
 * @returns Agent tool
 */
function convertMcpToolToAgentTool(serverId: string, tool: any): Tool {
  // Parse parameters
  const parameters = Object.entries(tool.inputSchema?.properties || {}).map(([name, schema]: [string, any]) => ({
    name,
    type: mapJsonSchemaTypeToToolType(schema.type),
    description: schema.description || name,
    required: tool.inputSchema?.required?.includes(name) || false,
  }))

  // Enhance tool description to help AI better understand the tool's purpose
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
 * Map JSON Schema types to tool parameter types
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
 * Get all tools, including MCP tools (if there are selected servers)
 */
export function getAllTools(): Tool[] {
  const tools = [...allTools]

  // Dynamically add MCP tools
  // Note: due to circular dependency issues, cannot use import directly here
  // MCP tools will be added at runtime through dynamic loading
  // Return base tool list here
  return tools
}

// MCP tools cache
let mcpToolsCache: Tool[] = []
let mcpToolsLoaded = false

/**
 * Get all tools, including MCP tools (async version)
 * This function is used for scenarios that need to load MCP tools
 */
export async function getAllToolsAsync(): Promise<Tool[]> {
  const tools = [...allTools]

  // Dynamically add MCP tools
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
 * Get tools (including loaded MCP tools)
 */
export function getAllToolsSync(): Tool[] {
  if (mcpToolsLoaded) {
    return [...allTools, ...mcpToolsCache]
  }
  return allTools
}

/**
 * Reload MCP tools
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
export * from './memory-tools'
export * from './editor-tools'
