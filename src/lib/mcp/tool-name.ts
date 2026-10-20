const MAX_TOOL_NAME_LENGTH = 64

function sanitizePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'tool'
}

function shortHash(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createMcpAgentToolName(serverId: string, serverName: string, toolName: string) {
  const suffix = shortHash(`${serverId}:${toolName}`)
  const readable = `mcp_${sanitizePart(serverName)}_${sanitizePart(toolName)}`
  return `${readable.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length - 1)}_${suffix}`
}
