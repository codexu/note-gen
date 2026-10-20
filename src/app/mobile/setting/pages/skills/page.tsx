'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useSkillsStore } from '@/stores/skills'
import { SkillsSettings } from '@/app/core/setting/skills/components/skills-settings'
import { SettingType } from '@/app/core/setting/components/setting-base'

export default function SkillsPage() {
  const t = useTranslations('settings.skills')
  const { initSkills } = useSkillsStore()

  useEffect(() => {
    void initSkills()
  }, [initSkills])

  return (
    <SettingType id="skills" title={t('title')} desc={t('desc')}>
      <SkillsSettings showFileActions={false} />
    </SettingType>
  )
}
