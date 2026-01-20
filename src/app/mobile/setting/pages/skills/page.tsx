'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useSkillsStore } from '@/stores/skills'
import { GlobalSkillsManager } from '@/app/core/setting/skills/components/global-skills-manager'

export default function SkillsPage() {
  const t = useTranslations('settings.skills')
  const { initSkills } = useSkillsStore()

  useEffect(() => {
    initSkills()
  }, [initSkills])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('desc')}</p>
      </div>
      <div className="space-y-6">
        <GlobalSkillsManager />
      </div>
    </div>
  )
}
