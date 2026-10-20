import type { AgentTool } from './types'
import { getSkillScriptPermissionKey } from '@/lib/skills/runtime'

export interface SessionApprovalScope {
  type: 'runtime-script'
  permissionKey: string
}

export function getSessionApprovalScope(
  toolName: string,
  tool: AgentTool | undefined,
  params: Record<string, unknown>
): SessionApprovalScope | null {
  if (!tool) {
    return null
  }

  if (tool.risk === 'script' || toolName === 'skill_execute_script') {
    const skillId = typeof params.skill_id === 'string' ? params.skill_id : ''
    const scriptId = typeof params.script_id === 'string' ? params.script_id : ''
    const args = Array.isArray(params.args)
      ? params.args.map(String)
      : Array.isArray(params.arguments)
        ? params.arguments.map(String)
        : []
    const permissionKey = skillId && scriptId
      ? getSkillScriptPermissionKey(skillId, scriptId, args)
      : null
    return permissionKey ? { type: 'runtime-script', permissionKey } : null
  }

  return null
}

export function matchesSessionApproval(
  approvedConversationId: number | null,
  activeConversationId: number | null,
  approvedRuntimeScriptKey: string | null,
  scope: SessionApprovalScope | null
): boolean {
  if (!scope || approvedConversationId === null || activeConversationId === null) {
    return false
  }

  if (approvedConversationId !== activeConversationId) {
    return false
  }

  return approvedRuntimeScriptKey === scope.permissionKey
}
