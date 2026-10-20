import { estimateTokens } from '@/lib/ai/token-counter'
import type { AgentTool, JsonSchema } from '@/lib/agent/types'
import { useMcpStore } from '@/stores/mcp'
import { mcpServerManager } from './server-manager'
import { normalizeMcpToolResult } from './result-normalizer'
import { createMcpAgentToolName } from './tool-name'
import type { MCPServerConfig, MCPTool } from './types'

const MAX_DIRECT_MCP_TOOLS = 32
const MAX_MCP_SCHEMA_TOKENS = 8_000

export interface McpToolCatalogEntry {
  server: MCPServerConfig
  tool: MCPTool
  agentToolName: string
  deferredReason?: 'count-budget' | 'schema-budget' | 'invalid-schema' | 'name-collision'
}

export interface McpAgentToolCatalog {
  directTools: AgentTool[]
  directEntries: McpToolCatalogEntry[]
  deferredEntries: McpToolCatalogEntry[]
  schemaTokens: number
}

function schemaForAgent(tool: MCPTool): JsonSchema | undefined {
  const schema = tool.inputSchema
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined
  if (schema.type !== undefined && schema.type !== 'object') return undefined

  return {
    ...schema,
    type: 'object',
    properties: schema.properties && typeof schema.properties === 'object' ? schema.properties : {},
  } as JsonSchema
}

function schemaTokens(tool: MCPTool) {
  return estimateTokens(JSON.stringify({ description: tool.description || '', inputSchema: tool.inputSchema }))
}

function createAgentTool(entry: McpToolCatalogEntry, schema: JsonSchema): AgentTool {
  const { server, tool, agentToolName } = entry
  return {
    name: agentToolName,
    title: tool.title || tool.annotations?.title || tool.name,
    description: tool.description || `Call ${tool.name} on MCP server ${server.name}.`,
    category: 'mcp',
    risk: 'external',
    inputSchema: schema,
    mcp: {
      serverId: server.id,
      serverName: server.name,
      toolName: tool.name,
      annotations: tool.annotations,
      trustToolAnnotations: server.trustToolAnnotations === true,
    },
    execute: async (input, context) => {
      try {
        const result = await mcpServerManager.callTool(server.id, tool.name, input, context.signal)
        return normalizeMcpToolResult(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, message, error: 'MCP_TOOL_CALL_FAILED' }
      }
    },
  }
}

export function buildMcpAgentToolCatalog(selectedServerIds?: string[]): McpAgentToolCatalog {
  const store = useMcpStore.getState()
  const selected = new Set(selectedServerIds ?? store.selectedServerIds)
  const directTools: AgentTool[] = []
  const directEntries: McpToolCatalogEntry[] = []
  const deferredEntries: McpToolCatalogEntry[] = []
  const usedNames = new Set<string>()
  let usedSchemaTokens = 0

  for (const server of store.servers) {
    if (!selected.has(server.id)) continue
    for (const tool of mcpServerManager.getServerTools(server.id)) {
      const agentToolName = createMcpAgentToolName(server.id, server.name, tool.name)
      const entry: McpToolCatalogEntry = { server, tool, agentToolName }
      const schema = schemaForAgent(tool)
      const tokens = schemaTokens(tool)

      if (!schema) entry.deferredReason = 'invalid-schema'
      else if (usedNames.has(agentToolName)) entry.deferredReason = 'name-collision'
      else if (directEntries.length >= MAX_DIRECT_MCP_TOOLS) entry.deferredReason = 'count-budget'
      else if (usedSchemaTokens + tokens > MAX_MCP_SCHEMA_TOKENS) entry.deferredReason = 'schema-budget'

      if (entry.deferredReason || !schema) {
        deferredEntries.push(entry)
        continue
      }

      usedNames.add(agentToolName)
      usedSchemaTokens += tokens
      directEntries.push(entry)
      directTools.push(createAgentTool(entry, schema))
    }
  }

  return { directTools, directEntries, deferredEntries, schemaTokens: usedSchemaTokens }
}
