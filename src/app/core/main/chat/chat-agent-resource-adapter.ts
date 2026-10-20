import { BUILTIN_SKILL_CREATOR } from '@/lib/skills/creator'
import { skillManager } from '@/lib/skills'
import { reloadMcpTools } from '@/lib/agent/tools'
import type { AgentResourceAdapter } from '@/lib/agent/agent-resource-adapter'
import { useSkillsStore } from '@/stores/skills'
import { useMcpStore } from '@/stores/mcp'
import { readCurrentEditorState } from '@/lib/agent/tools/editor-tools'

export const chatAgentResourceAdapter: AgentResourceAdapter = {
  initializeMcp: async () => {
    try {
      const mcpStore = useMcpStore.getState()
      if (!mcpStore.initialized) {
        await mcpStore.initMcpData()
      }
      await reloadMcpTools()
    } catch (error) {
      console.error('[Agent Handler] Failed to initialize MCP:', error)
    }
  },

  getSelectedMcpServerIds: () => [...useMcpStore.getState().selectedServerIds],

  getSkillsInfo: async (selectedSkillIds) => {
    const skillsStore = useSkillsStore.getState()
    const creator = {
      id: BUILTIN_SKILL_CREATOR.id,
      name: BUILTIN_SKILL_CREATOR.name,
      description: BUILTIN_SKILL_CREATOR.description,
    }

    if (!skillsStore.enabled) return []

    try {
      await skillsStore.initSkills()
      const enabledSkills = await skillManager.getEnabledSkills()
      const selectedIds = new Set(selectedSkillIds)
      const visibleSkills = skillsStore.autoMatch
        ? enabledSkills
        : enabledSkills.filter(skill => selectedIds.has(skill.metadata.id))

      return [creator, ...visibleSkills
        .filter(skill => skill.metadata.id !== BUILTIN_SKILL_CREATOR.id)
        .map(skill => ({
          id: skill.metadata.id,
          name: skill.metadata.name,
          description: skill.metadata.description,
          scope: skill.metadata.scope,
        }))]
    } catch (error) {
      console.error('[Agent Handler] Failed to load skills:', error)
      return [creator]
    }
  },

  getSkillSummary: (skillId) => {
    if (skillId === BUILTIN_SKILL_CREATOR.id) {
      return {
        id: BUILTIN_SKILL_CREATOR.id,
        name: BUILTIN_SKILL_CREATOR.name,
        description: BUILTIN_SKILL_CREATOR.description,
      }
    }

    const skill = skillManager.getSkill(skillId)
    if (!skill) return undefined
    return {
      id: skill.metadata.id,
      name: skill.metadata.name,
      description: skill.metadata.description,
      scope: skill.metadata.scope,
    }
  },

  getCurrentEditorState: async (activeFilePath) => (
    activeFilePath
      ? await readCurrentEditorState().catch(() => undefined)
      : undefined
  ),
}
