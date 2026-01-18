'use client'

import { useTranslations } from 'next-intl'
import { useSkillsStore } from '@/stores/skills'
import { GlobalSkillsManager } from './global-skills-manager'

export function SkillsSettings() {
  const { globalSkills } = useSkillsStore()

  return (
    <div className="skills-settings">
      <GlobalSkillsManager />
    </div>
  )
}
