export type ToolRiskLevel = 'low' | 'medium' | 'high'

export interface IntentPolicy {
  allowWrite: boolean
  allowDestructive: boolean
  allowExecute: boolean
}

export const HIGH_RISK_TOOLS = new Set([
  'execute_skill_script',
  'delete_markdown_file',
  'delete_markdown_files_batch',
  'delete_folder',
  'delete_folders_batch',
  'delete_tag',
  'delete_mark',
  'delete_marks_batch',
  'delete_chat',
  'delete_chats_batch',
  'clear_chats',
  'clear_all_memories',
  'delete_memory',
])

export const MEDIUM_RISK_TOOLS = new Set([
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
])

export const READ_ONLY_TOOLS = new Set([
  'select_skill',
  'load_skill_content',
  'get_editor_selection',
  'get_editor_content',
  'get_current_time',
  'check_folder_exists',
  'list_folders',
  'list_markdown_files',
  'read_markdown_file',
  'read_marks',
  'read_chats',
  'read_tags',
])

export function deriveIntentPolicy(userInput: string): IntentPolicy {
  const input = userInput.toLowerCase()

  const writePatterns = [
    /创建|新建|新增|写入|改写|修改|编辑|更新|重写|插入|替换|保存|改|优化|精简|简化|润色|调整|补充|增加|添加|补全|扩写|完善|丰富|重命名|改名|命名为|移动|复制/,
    /\b(create|write|modify|edit|update|insert|replace|save|rename|move)\b/i,
  ]
  const destructivePatterns = [
    /删除|移除|清空|清除/,
    /\b(delete|remove|clear|wipe|purge)\b/i,
  ]
  const executePatterns = [
    /执行|运行|命令|脚本|终端|shell|bash|python|node|npm|pnpm/,
    /\b(run|execute|command|script|terminal|shell|bash|python|node|npm|pnpm)\b/i,
  ]
  const skillExecutionPatterns = [
    /(用|使用).*(skill|技能).*(生成|导出|转换|制作|渲染|输出)/,
    /(生成|导出|转换|制作|渲染|输出).*(pptx|pdf|docx|xlsx|图片|演示文稿|文件)/,
    /\b(use .*skill.*(?:generate|export|convert|render|build))\b/i,
  ]
  const denyDestructivePatterns = [
    /不要删除|别删除|禁止删除|不删|不要清空|别清空|禁止清空/,
    /\b(do not delete|don't delete|no delete|do not remove|don't remove|do not clear|don't clear)\b/i,
  ]
  const denyExecutePatterns = [
    /不要执行|别执行|不运行|禁止执行/,
    /\b(do not execute|don't execute|do not run|don't run)\b/i,
  ]

  const allowWrite =
    writePatterns.some((pattern) => pattern.test(input)) ||
    skillExecutionPatterns.some((pattern) => pattern.test(input))
  const allowDestructive =
    destructivePatterns.some((pattern) => pattern.test(input)) &&
    !denyDestructivePatterns.some((pattern) => pattern.test(input))
  const allowExecute =
    (executePatterns.some((pattern) => pattern.test(input)) ||
      skillExecutionPatterns.some((pattern) => pattern.test(input))) &&
    !denyExecutePatterns.some((pattern) => pattern.test(input))

  return {
    allowWrite,
    allowDestructive,
    allowExecute,
  }
}

export function formatIntentPolicyForPrompt(intentPolicy: IntentPolicy): string {
  const writeMode = intentPolicy.allowWrite ? 'enabled' : 'disabled'
  const destructiveMode = intentPolicy.allowDestructive ? 'enabled' : 'disabled'
  const executeMode = intentPolicy.allowExecute ? 'enabled' : 'disabled'

  return [
    `- Write mode: ${writeMode}`,
    `- Destructive mode: ${destructiveMode}`,
    `- Execute mode: ${executeMode}`,
    '- If a mode is disabled, do not call related tools; give Final Answer and ask for explicit user confirmation instead.',
    '- High-risk tools always require confirmation before execution.',
  ].join('\n')
}

export function isExecuteTool(toolName: string): boolean {
  return toolName === 'execute_skill_script'
}

export function isDestructiveTool(toolName: string): boolean {
  return (
    toolName.startsWith('delete_') ||
    toolName.includes('_delete_') ||
    toolName.startsWith('clear_') ||
    toolName.includes('remove')
  )
}

function isReadOnlyTool(toolName: string): boolean {
  if (READ_ONLY_TOOLS.has(toolName)) {
    return true
  }

  const readPrefixes = ['read_', 'list_', 'search_', 'get_']
  return readPrefixes.some((prefix) => toolName.startsWith(prefix))
}

export function getToolRiskLevel(toolName: string, category: string): ToolRiskLevel {
  if (HIGH_RISK_TOOLS.has(toolName)) {
    return 'high'
  }

  if (MEDIUM_RISK_TOOLS.has(toolName)) {
    return 'medium'
  }

  if (READ_ONLY_TOOLS.has(toolName)) {
    return 'low'
  }

  if (isExecuteTool(toolName) || isDestructiveTool(toolName)) {
    return 'high'
  }

  if (category === 'editor') {
    if (toolName === 'get_editor_selection' || toolName === 'get_editor_content') {
      return 'low'
    }
    return 'medium'
  }

  if (isReadOnlyTool(toolName)) {
    return 'low'
  }

  return 'medium'
}
