'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'
import { useSkillsStore } from '@/stores/skills'
import { SkillCard } from './skill-card'

export function ProjectSkillsList() {
  const t = useTranslations('settings.skills')
  const { projectSkills, refreshSkills } = useSkillsStore()

  const handleRefresh = async () => {
    await refreshSkills()
  }

  return (
    <div className="project-skills-list">
      {/* 操作栏 */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">
          {t('project')} ({projectSkills.length})
        </h3>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          刷新
        </Button>
      </div>

      {/* Skills 列表 */}
      <div className="space-y-2">
        {projectSkills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onRefresh={handleRefresh}
          />
        ))}

        {projectSkills.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Sparkles className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>{t('emptyWorkspace')}</p>
            <p className="text-sm">{t('emptyWorkspaceDesc')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
