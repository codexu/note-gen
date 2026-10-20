import { agentToolRegistry } from '../tool-registry'
import type { AgentTool } from '../types'

export function getAllTools(): AgentTool[] {
  return agentToolRegistry.listTools()
}

export async function getAllToolsAsync(): Promise<AgentTool[]> {
  return agentToolRegistry.listTools()
}

export function getAllToolsSync(): AgentTool[] {
  return agentToolRegistry.listTools()
}

export async function reloadMcpTools(): Promise<void> {
  // MCP tools are exposed through mcp_call_tool and the prompt-side catalog,
  // so there is no runtime cache to refresh here.
}

export function getToolByName(name: string): AgentTool | undefined {
  return agentToolRegistry.getTool(name)
}

export function getToolsByCategory(category: AgentTool['category']): AgentTool[] {
  return agentToolRegistry.listTools().filter((tool) => tool.category === category)
}

export function getToolDescriptions(): string {
  return agentToolRegistry.listTools().map((tool) => {
    return `### ${tool.name}
${tool.title}
${tool.description}
Category: ${tool.category}
Risk: ${tool.risk}`
  }).join('\n\n')
}

export * from '../tool-registry'
export * from './note-tools'
export * from './chat-tools'
export * from './tag-tools'
export * from './mark-tools'
export * from './folder-tools'
export * from './system-tools'
export * from './memory-tools'
export * from './editor-tools'
export * from './knowledge-tools'
