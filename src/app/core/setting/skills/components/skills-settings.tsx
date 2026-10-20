'use client'

import { GlobalSkillsManager } from './global-skills-manager'
import { ProjectSkillsList } from './project-skills-list'

export function SkillsSettings({ showFileActions = true }: { showFileActions?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <ProjectSkillsList showFileActions={showFileActions} />
      <GlobalSkillsManager showFileActions={showFileActions} />
    </div>
  )
}
