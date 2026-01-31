'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Sparkles, Upload, Loader2, Info } from 'lucide-react'
import { useSkillsStore } from '@/stores/skills'
import { SkillCard } from './skill-card'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useToast } from '@/hooks/use-toast'

export function GlobalSkillsManager() {
  const t = useTranslations('settings.skills')
  const { toast } = useToast()
  const { globalSkills, refreshSkills } = useSkillsStore()
  const [isImporting, setIsImporting] = useState(false)

  const handleImport = async () => {
    try {
      setIsImporting(true)

      // 选择 zip 文件
      const filePath = await open({
        title: t('selectSkillZip'),
        filters: [{
          name: 'ZIP Files',
          extensions: ['zip']
        }],
        multiple: false
      })

      if (!filePath || Array.isArray(filePath)) {
        setIsImporting(false)
        return
      }

      // 调用后端命令导入 Skill
      const skillName = await invoke<string>('import_skill_zip', { zipPath: filePath })

      toast({
        title: t('importSuccess'),
        description: `${skillName} ${t('imported')}`,
      })

      // 刷新 Skills 列表
      await refreshSkills()
    } catch (error) {
      console.error('Import skill failed:', error)
      toast({
        title: t('importError'),
        description: (error as Error).message,
        variant: 'destructive',
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="global-skills-manager">
      {/* 操作栏 */}
      <div className="flex max-md:flex-col max-md:items-start max-md:gap-4 justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold">
            {t('installedGlobalSkills')} ({globalSkills.length})
          </h3>
          {/* 导入说明 */}
          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
            <Info className="size-4" />
            <p>{t('importHelp')}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleImport} disabled={isImporting}>
          {isImporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {isImporting ? t('importing') : t('importSkill')}
        </Button>
      </div>

      {/* Skills 列表 */}
      <div className="space-y-2">
        {globalSkills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onRefresh={refreshSkills}
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
