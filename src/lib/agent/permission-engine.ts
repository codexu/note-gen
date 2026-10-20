import { mcpServerManager } from '@/lib/mcp/server-manager'
import type { MCPToolAnnotations } from '@/lib/mcp/types'
import { useMcpStore } from '@/stores/mcp'
import type { AgentPermissionMode, AgentTool, AgentToolRisk } from './types'
import { getSkillScriptPermissionKey } from '@/lib/skills/runtime'

export interface PermissionDecision {
  allowed: boolean
  requiresApproval: boolean
  reason?: string
  canApproveForSession?: boolean
  sessionApprovalType?: 'runtime-script'
  sessionApprovalKey?: string
}

const LOCAL_WRITE_RISKS = new Set<AgentToolRisk>([
  'editor-write',
  'file-create',
  'file-update',
  'medium',
])

function getMcpPermissionMetadata(tool: AgentTool, input: Record<string, unknown>): {
  annotations?: MCPToolAnnotations
  trustToolAnnotations: boolean
} {
  if (tool.mcp) {
    return {
      annotations: tool.mcp.annotations,
      trustToolAnnotations: tool.mcp.trustToolAnnotations,
    }
  }

  const serverId = typeof input.serverId === 'string' ? input.serverId : ''
  const toolName = typeof input.toolName === 'string' ? input.toolName : ''

  if (!serverId || !toolName) {
    return { trustToolAnnotations: false }
  }

  const server = useMcpStore.getState().servers.find(item => item.id === serverId)
  return {
    annotations: mcpServerManager.getServerTools(serverId).find(item => item.name === toolName)?.annotations,
    trustToolAnnotations: server?.trustToolAnnotations === true,
  }
}

/**
 * Evaluates a concrete, structured tool call. Natural-language intent belongs to
 * the model planner and must not be re-classified in the permission boundary.
 */
export class AgentPermissionEngine {
  evaluate(
    tool: AgentTool,
    input: Record<string, unknown>,
    mode: AgentPermissionMode = 'ask'
  ): PermissionDecision {
    if (tool.risk === 'read') {
      return {
        allowed: true,
        requiresApproval: false,
      }
    }

    if (tool.risk === 'external') {
      const metadata = getMcpPermissionMetadata(tool, input)
      const isReadOnly = metadata.trustToolAnnotations && metadata.annotations?.readOnlyHint === true
      const isDestructive = metadata.annotations?.destructiveHint === true

      if (mode === 'read-only' && !isReadOnly) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: '当前为只读模式，无法执行可能修改外部数据的操作。',
        }
      }

      return {
        allowed: true,
        requiresApproval: isDestructive || !isReadOnly,
      }
    }

    if (mode === 'read-only') {
      return {
        allowed: false,
        requiresApproval: false,
        reason: '当前为只读模式。请切换权限模式后再执行修改操作。',
      }
    }

    if (tool.risk === 'delete') {
      return {
        allowed: true,
        requiresApproval: true,
      }
    }

    if (tool.risk === 'skill-install') {
      return {
        allowed: true,
        requiresApproval: true,
      }
    }

    if (tool.risk === 'script') {
      const skillId = typeof input.skill_id === 'string' ? input.skill_id : ''
      const scriptId = typeof input.script_id === 'string' ? input.script_id : ''
      const args = Array.isArray(input.args)
        ? input.args.map(String)
        : Array.isArray(input.arguments)
          ? input.arguments.map(String)
          : []
      const permissionKey = skillId && scriptId
        ? getSkillScriptPermissionKey(skillId, scriptId, args)
        : null

      return {
        allowed: true,
        requiresApproval: true,
        canApproveForSession: Boolean(permissionKey),
        sessionApprovalType: permissionKey ? 'runtime-script' : undefined,
        sessionApprovalKey: permissionKey || undefined,
      }
    }

    if (mode === 'auto-edit' && LOCAL_WRITE_RISKS.has(tool.risk)) {
      return {
        allowed: true,
        requiresApproval: false,
      }
    }

    return {
      allowed: true,
      requiresApproval: true,
    }
  }
}

export function isWriteLikeRisk(risk: AgentToolRisk) {
  return LOCAL_WRITE_RISKS.has(risk)
}
