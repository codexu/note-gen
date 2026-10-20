'use client'

import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'
import { useSkillsStore } from '@/stores/skills'
import { SkillCard } from './skill-card'
import { SettingSection } from '../../components/setting-base'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ItemGroup } from '@/components/ui/item'
import { SkillInstallActions } from './skill-install-actions'

export function ProjectSkillsList({ showFileActions = true }: { showFileActions?: boolean }) {
  const t = useTranslations('settings.skills')
  const { projectSkills, refreshSkills } = useSkillsStore()

  const handleRefresh = async () => {
    await refreshSkills()
  }

  return (
    <SettingSection
      title={`${t('project')} (${projectSkills.length})`}
      desc={t('workspaceInstallHelp')}
      actions={(
        <SkillInstallActions
          scope="project"
          onInstalled={handleRefresh}
          showFileActions={showFileActions}
        />
      )}
    >
      {projectSkills.length > 0 ? (
        <ItemGroup className="gap-2">
          {projectSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onRefresh={handleRefresh}
            />
          ))}
        </ItemGroup>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Sparkles /></EmptyMedia>
            <EmptyTitle>{t('emptyWorkspace')}</EmptyTitle>
            <EmptyDescription>{t('emptyWorkspaceDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </SettingSection>
  )
}
