'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Sparkles, Trash } from 'lucide-react'
import { useSkillsStore } from '@/stores/skills'
import { Badge } from '@/components/ui/badge'
import { inspectSkillPython, type SkillPythonStatus } from '@/lib/skills/runtime'
import { SkillMetadata } from '@/lib/skills/types'
import { Spinner } from '@/components/ui/spinner'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface SkillCardProps {
  skill: SkillMetadata
  onRefresh: () => void
}

export function SkillCard({ skill, onRefresh }: SkillCardProps) {
  const t = useTranslations('settings.skills')
  const tc = useTranslations('common')
  const { getSkill, toggleSkill, deleteSkill } = useSkillsStore()

  const [pythonStatus, setPythonStatus] = useState<SkillPythonStatus | null>(null)

  const skillContent = getSkill(skill.id)
  const hasPythonScripts = skillContent?.scripts.some(script => script.type === 'python') ?? false

  useEffect(() => {
    if (!hasPythonScripts) return
    let active = true
    void inspectSkillPython(skill.id)
      .then(status => {
        if (active) setPythonStatus(status)
      })
      .catch(error => console.error('Failed to inspect Skill Python runtime:', error))
    return () => {
      active = false
    }
  }, [hasPythonScripts, skill.id])

  const handleDelete = async () => {
    try {
      await deleteSkill(skill.id, skill.scope)
      onRefresh()
    } catch (error) {
      console.error('Failed to delete skill:', error)
    }
  }

  return (
    <Item variant="outline" className="mobile-setting-skill-card">
      <div className="mobile-setting-skill-summary">
        <ItemMedia variant="icon" className="text-muted-foreground">
          <Sparkles />
        </ItemMedia>
        <ItemContent className="w-0">
          <ItemTitle className="w-full min-w-0">{skill.name}</ItemTitle>
          {skill.description ? <ItemDescription>{skill.description}</ItemDescription> : null}
          {hasPythonScripts && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t('pythonRuntime')}:</span>
              {!pythonStatus ? (
                <Spinner />
              ) : pythonStatus.available ? (
                <Badge variant="secondary">
                  Python {pythonStatus.version} · {pythonStatus.managed ? t('isolatedRuntime') : t('systemRuntime')}
                </Badge>
              ) : (
                <Badge variant="destructive">{t('runtimeUnavailable')}</Badge>
              )}
            </div>
          )}
        </ItemContent>
      </div>
      <ItemActions className="mobile-setting-skill-controls">
        <Switch
          checked={skill.enabled !== false}
          onCheckedChange={() => toggleSkill(skill.id)}
          aria-label={`${t('enable')}: ${skill.name}`}
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label={t('deleteSkill')}
            >
              <Trash />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('deleteSkillTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('deleteSkillDesc')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete}>
                {tc('delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ItemActions>
    </Item>
  )
}
