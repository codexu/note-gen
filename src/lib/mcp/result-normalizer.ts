import { estimateTokens } from '@/lib/ai/token-counter'
import type { AgentToolResult } from '@/lib/agent/types'
import type { CallToolResult } from './types'

const MAX_MCP_RESULT_TOKENS = 12_000

function truncateResult(value: string) {
  if (estimateTokens(value) <= MAX_MCP_RESULT_TOKENS) return { value, truncated: false }

  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokens(value.slice(0, middle)) <= MAX_MCP_RESULT_TOKENS) low = middle
    else high = middle - 1
  }
  return {
    value: `${value.slice(0, low)}\n\n[MCP result truncated to fit the agent context.]`,
    truncated: true,
  }
}

export function normalizeMcpToolResult(result: CallToolResult): AgentToolResult {
  const parts: string[] = []

  for (const item of result.content || []) {
    if (item.type === 'text') parts.push(item.text)
    else if (item.type === 'image' || item.type === 'audio') {
      const bytes = Math.max(0, Math.floor((item.data.replace(/\s/g, '').length * 3) / 4))
      parts.push(`[MCP ${item.type}: ${item.mimeType}, ${bytes} bytes]`)
    } else if (item.type === 'resource') {
      if (item.resource.text) parts.push(item.resource.text)
      else if (item.resource.blob) parts.push(`[Binary MCP resource omitted: ${item.resource.uri} (${item.resource.mimeType || 'application/octet-stream'})]`)
      else parts.push(`[MCP resource: ${item.resource.uri}]`)
    } else if (item.type === 'resource_link') {
      parts.push(`[MCP resource link: ${item.title || item.name}](${item.uri})`)
    }
  }

  if (parts.length === 0 && result.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2))

  const fallback = result.isError ? 'MCP tool returned an error without details.' : 'MCP tool completed without text output.'
  const normalized = truncateResult(parts.join('\n\n') || fallback)
  const safeContent = result.content.map(item => {
    if (item.type === 'image' || item.type === 'audio') {
      return { type: item.type, mimeType: item.mimeType, omittedBytes: Math.max(0, Math.floor((item.data.replace(/\s/g, '').length * 3) / 4)) }
    }
    if (item.type === 'resource' && item.resource.blob) {
      return { type: item.type, resource: { uri: item.resource.uri, mimeType: item.resource.mimeType, blobOmitted: true } }
    }
    return item
  })
  return {
    ok: !result.isError,
    message: normalized.value,
    data: {
      content: safeContent,
      structuredContent: result.structuredContent,
      metadata: result._meta,
      truncated: normalized.truncated,
    },
    error: result.isError ? normalized.value : undefined,
  }
}
