import type { AgentEditorStateSnapshot, AgentSkillSummary } from './types'

export interface AgentResourceAdapter {
  initializeMcp: () => Promise<void>
  getSelectedMcpServerIds: () => string[]
  getSkillsInfo: (selectedSkillIds: string[]) => Promise<AgentSkillSummary[]>
  getSkillSummary: (skillId: string) => AgentSkillSummary | undefined
  getCurrentEditorState: (activeFilePath?: string) => Promise<AgentEditorStateSnapshot | undefined>
}
