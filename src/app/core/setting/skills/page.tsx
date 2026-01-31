'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { SettingType } from '../components/setting-base'
import { useSkillsStore } from '@/stores/skills'
import { SkillsSettings } from './components/skills-settings'

export default function SkillsSettingPage() {
  const t = useTranslations('settings.skills')
  const { initSkills } = useSkillsStore()

  useEffect(() => {
    initSkills()
  }, [initSkills])

  return (
    <SettingType
      id="skills"
      title={t('title')}
      desc={t('desc')}
      icon={<Sparkles />}
    >
      <SkillsSettings />
    </SettingType>
  )
}
