'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Sparkles, Plus, Upload } from 'lucide-react'
import { useSkillsStore } from '@/stores/skills'
import { SkillCard } from './skill-card'

export function GlobalSkillsManager() {
  const t = useTranslations('settings.skills')
  const { globalSkills, refreshSkills } = useSkillsStore()

  const handleRefresh = async () => {
    await refreshSkills()
  }

  const handleImport = () => {
    // TODO: 实现导入功能
    console.log('Import Skill')
  }

  const handleCreate = () => {
    // TODO: 实现创建功能
    console.log('Create Skill')
  }

  return (
    <div className="global-skills-manager">
      {/* 操作栏 */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">
          {t('installedGlobalSkills')} ({globalSkills.length})
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleImport}>
            <Upload className="size-4" />
            {t('importSkill')}
          </Button>
          <Button size="sm" onClick={handleCreate}>
            <Plus className="size-4" />
            {t('createSkill')}
          </Button>
        </div>
      </div>

      {/* Skills 列表 */}
      <div className="space-y-2">
        {globalSkills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onRefresh={handleRefresh}
          />
        ))}

        {globalSkills.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Sparkles className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>{t('noSkillsGlobal')}</p>
            <p className="text-sm">{t('noSkillsGlobalDesc')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
