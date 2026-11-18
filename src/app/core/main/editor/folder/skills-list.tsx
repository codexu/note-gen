'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SkillMetadata } from '@/lib/skills/types'

interface SkillsListViewProps {
  skills: SkillMetadata[]
}

export function SkillsListView({ skills }: SkillsListViewProps) {
  const t = useTranslations('article.file.folderView')

  // 按 scope 分组
  const globalSkills = skills.filter(s => s.scope === 'global')
  const projectSkills = skills.filter(s => s.scope === 'project')

  // 跟踪每个技能的展开状态
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set())

  const toggleExpanded = (skillId: string) => {
    setExpandedSkills(prev => {
      const next = new Set(prev)
      if (next.has(skillId)) {
        next.delete(skillId)
      } else {
        next.add(skillId)
      }
      return next
    })
  }

  return (
    <div className="flex-1 h-full flex flex-col items-center bg-background gap-6 p-8 overflow-y-auto">
      {/* Skills Icon and Name */}
      <div className="flex flex-col items-center gap-3 shrink-0">
        <Sparkles className="w-20 h-20 text-ink" />
        <h2 className="text-2xl font-semibold tracking-tight">{t('skills')} ({skills.length})</h2>
      </div>

      {/* Skills 列表 */}
      {skills.length === 0 ? null : (
        <div className="flex flex-col gap-4 w-full max-w-2xl shrink-0">
          {/* 全局 Skills */}
          {globalSkills.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground px-1">{t('globalSkills')}</h3>
              <div className="space-y-2">
                {globalSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="p-4 border rounded-lg hover:bg-hover transition-colors bg-hover cursor-pointer"
                    onClick={() => toggleExpanded(skill.id)}
                  >
                    <div className="flex items-start gap-4">
                      <Sparkles className="size-5 text-ink mt-1" />
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">{skill.name}</h3>
                        <p className="text-sm text-muted-foreground cursor-pointer">
                          {expandedSkills.has(skill.id) ? skill.description : (
                            <span className="line-clamp-1">{skill.description}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 工作区 Skills */}
          {projectSkills.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground px-1">{t('workspaceSkills')}</h3>
              <div className="space-y-2">
                {projectSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="p-4 border rounded-lg hover:bg-hover transition-colors bg-hover cursor-pointer"
                    onClick={() => toggleExpanded(skill.id)}
                  >
                    <div className="flex items-start gap-4">
                      <Sparkles className="size-5 text-ink mt-1" />
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">{skill.name}</h3>
                        <p className="text-sm text-muted-foreground cursor-pointer">
                          {expandedSkills.has(skill.id) ? skill.description : (
                            <span className="line-clamp-1">{skill.description}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
