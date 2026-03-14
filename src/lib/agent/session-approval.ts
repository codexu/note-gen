import type { Tool } from './types'

export interface SessionApprovalScope {
  type: 'write' | 'runtime-script-skill'
  skillId?: string
}

function isRecoverableWriteToolLocally(toolName: string, tool: Tool | undefined): boolean {
  if (!tool) {
    return false
  }

  if (tool.category === 'editor') {
    return !toolName.startsWith('delete_') && toolName !== 'execute_skill_script'
  }

  return [
    'create_file',
    'create_files_batch',
    'create_mark',
    'create_marks_batch',
    'update_mark',
    'update_marks_batch',
    'create_tag',
    'update_tag',
    'create_chat',
    'create_chats_batch',
    'update_chat',
    'update_chats_batch',
    'insert_at_cursor',
    'replace_editor_content',
    'rename_file',
    'move_file',
    'copy_file',
    'rename_files_batch',
    'move_files_batch',
    'copy_files_batch',
  ].includes(toolName)
}

function classifySkillScriptPathLocally(arg: string): 'generated-runtime-script' | 'runtime-script' | 'builtin-skill-script' | 'other' {
  const normalized = arg.replace(/\\/g, '/')

  if (/^skills\/[^/]+\/scripts\/[^/]+\/[^/]+$/.test(normalized)) {
    return 'generated-runtime-script'
  }

  if (normalized.startsWith('scripts/')) {
    return 'builtin-skill-script'
  }

  if (!normalized.includes('/') && /\.(py|js|mjs|cjs|sh|bash)$/i.test(normalized)) {
    return 'runtime-script'
  }

  return 'other'
}

export function getSessionApprovalScope(
  toolName: string,
  tool: Tool | undefined,
  params: Record<string, any>
): SessionApprovalScope | null {
  if (isRecoverableWriteToolLocally(toolName, tool)) {
    return { type: 'write' }
  }

  if (toolName !== 'execute_skill_script') {
    return null
  }

  const skillId = typeof params.skill_id === 'string' ? params.skill_id.trim() : ''
  const firstArg = Array.isArray(params.args) && typeof params.args[0] === 'string'
    ? params.args[0]
    : ''
  if (!skillId || !firstArg) {
    return null
  }

  const classified = classifySkillScriptPathLocally(firstArg)
  if (classified === 'runtime-script' || classified === 'generated-runtime-script') {
    return {
      type: 'runtime-script-skill',
      skillId,
    }
  }

  return null
}

export function matchesSessionApproval(
  approvedConversationId: number | null,
  activeConversationId: number | null,
  approvedRuntimeScriptSkillId: string | null,
  scope: SessionApprovalScope | null
): boolean {
  if (!scope || approvedConversationId === null || activeConversationId === null) {
    return false
  }

  if (approvedConversationId !== activeConversationId) {
    return false
  }

  if (scope.type === 'write') {
    return true
  }

  return scope.type === 'runtime-script-skill' && !!scope.skillId && approvedRuntimeScriptSkillId === scope.skillId
}
