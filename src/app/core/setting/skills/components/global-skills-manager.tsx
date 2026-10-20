'use client'

import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ItemGroup } from '@/components/ui/item'
import { useSkillsStore } from '@/stores/skills'
import { SkillCard } from './skill-card'
import { SettingSection } from '../../components/setting-base'
import { SkillInstallActions } from './skill-install-actions'

export function GlobalSkillsManager({ showFileActions = true }: { showFileActions?: boolean }) {
  const t = useTranslations('settings.skills')
  const { globalSkills, refreshSkills } = useSkillsStore()

  return (
    <SettingSection
      title={`${t('installedGlobalSkills')} (${globalSkills.length})`}
      desc={t('globalInstallHelp')}
      actions={(
        <SkillInstallActions
          scope="global"
          onInstalled={refreshSkills}
          showFileActions={showFileActions}
        />
      )}
    >
      {globalSkills.length > 0 ? (
        <ItemGroup className="gap-2">
          {globalSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onRefresh={refreshSkills}
            />
          ))}
        </ItemGroup>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Sparkles /></EmptyMedia>
            <EmptyTitle>{t('noSkillsGlobal')}</EmptyTitle>
            <EmptyDescription>{t('noSkillsGlobalDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </SettingSection>
  )
}
