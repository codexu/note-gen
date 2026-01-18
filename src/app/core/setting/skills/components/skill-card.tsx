'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sparkles, Edit2, Trash } from 'lucide-react'
import { useSkillsStore } from '@/stores/skills'
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
  skill: {
    id: string
    name: string
    description: string
    version: string
    author?: string
    scope: 'global' | 'project'
    allowedTools?: string[]
    userInvocable: boolean
    enabled: boolean
    createdAt: number
    updatedAt: number
  }
  onRefresh: () => void
}

export function SkillCard({ skill, onRefresh }: SkillCardProps) {
  const t = useTranslations('settings.skills')
  const tc = useTranslations('common')
  const { toggleSkill, getSkill } = useSkillsStore()

  const handleToggle = async () => {
    await toggleSkill(skill.id)
    onRefresh()
  }

  const handleDelete = async () => {
    await toggleSkill(skill.id)
    onRefresh()
  }

  const skillContent = getSkill(skill.id)

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <CardTitle className="text-lg">{skill.name}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={skill.enabled}
              onCheckedChange={handleToggle}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          {skill.description}
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {/* 作者 */}
            {skill.author && <span>{skill.author}</span>}

            {/* 允许的工具 */}
            {skill.allowedTools && skill.allowedTools.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {skill.allowedTools.length} 个工具
              </Badge>
            )}

            {/* 斜杠菜单 */}
            {skill.userInvocable && (
              <Badge variant="outline" className="text-xs">
                /{skill.name}
              </Badge>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // TODO: 打开编辑对话框
                console.log('Edit skill:', skill.id)
              }}
            >
              <Edit2 className="size-4" />
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Trash className="size-4" />
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
                  <AlertDialogAction onClick={handleDelete}>
                    {tc('delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* 指令预览 - 最多 3 行，超出滚动 */}
        {skillContent && (
          <div className="mt-4 p-3 bg-muted rounded-md">
            <p className="text-xs text-muted-foreground mb-1">
              {t('instructions')}:
            </p>
            <div className="text-sm max-h-20 overflow-y-auto leading-relaxed">
              <pre className="whitespace-pre-wrap font-sans">
                {skillContent.instructions}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
