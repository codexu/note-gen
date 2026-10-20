import { invoke } from '@tauri-apps/api/core'
import { getWorkspacePath } from '@/lib/workspace'
import type { SkillScope } from './types'

export interface UninstallSkillResult {
  skillId: string
  scope: SkillScope
  removedReceipt: boolean
  removedRuntime: boolean
  warnings: string[]
}

export async function uninstallSkill(
  skillId: string,
  scope: SkillScope,
): Promise<UninstallSkillResult> {
  const workspace = scope === 'project' ? await getWorkspacePath() : null
  return await invoke<UninstallSkillResult>('uninstall_skill', {
    request: {
      skillId,
      scope,
      workspaceRoot: workspace?.isCustom ? workspace.path : null,
    },
  })
}
