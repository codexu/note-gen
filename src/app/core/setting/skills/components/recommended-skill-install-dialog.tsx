'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, Download } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useToast } from '@/hooks/use-toast'
import { getRecommendedSkillText, type RecommendedSkill } from '@/lib/skills/recommendations'
import { inspectRemoteSkill, installRemoteSkill, type RemoteSkillPreview } from '@/lib/skills/remote'
import type { SkillScope } from '@/lib/skills/types'
import { useSkillsStore } from '@/stores/skills'

interface RecommendedSkillInstallDialogProps {
  skill: RecommendedSkill
  onClose: () => void
}

function formatBytes(value: number) {
  return value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${Math.ceil(value / 1024 ** 2)} MB`
}

export function RecommendedSkillInstallDialog({ skill, onClose }: RecommendedSkillInstallDialogProps) {
  const t = useTranslations('settings.skills.recommended')
  const ts = useTranslations('settings.skills')
  const tc = useTranslations('common')
  const tr = useTranslations('record.chat.input.agent.confirmation.tools.install_remote_skill.risks')
  const locale = useLocale()
  const { toast } = useToast()
  const globalSkills = useSkillsStore(state => state.globalSkills)
  const projectSkills = useSkillsStore(state => state.projectSkills)
  const [scope, setScope] = useState<SkillScope>('global')
  const [preview, setPreview] = useState<RemoteSkillPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [installing, setInstalling] = useState(false)
  const mounted = useRef(true)
  const installPending = useRef(false)
  const installed = (scope === 'global' ? globalSkills : projectSkills).some(item => item.id === skill.id)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setPreview(null)
    setError(null)
    void inspectRemoteSkill(skill.sourceUrl, controller.signal)
      .then(result => {
        if (!active) return
        if (result.name !== skill.id) {
          setError(t('skillMismatch'))
          return
        }
        setPreview(result)
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [skill, attempt, t])

  const handleInstall = async () => {
    if (!preview || installed || installPending.current) return
    installPending.current = true
    setInstalling(true)
    try {
      const result = await installRemoteSkill({ previewId: preview.previewId, scope })
      toast({ title: t('installSuccess', { name: result.name }) })
      try {
        await useSkillsStore.getState().refreshSkills()
      } catch (reason) {
        console.error('Failed to refresh installed Skills:', reason)
        toast({ title: t('refreshSkillsError'), variant: 'destructive' })
      }
      if (mounted.current) onClose()
    } catch (reason) {
      toast({
        title: t('installError'),
        description: reason instanceof Error ? reason.message : String(reason),
        variant: 'destructive',
      })
    } finally {
      installPending.current = false
      if (mounted.current) setInstalling(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !installPending.current) onClose() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" showCloseButton={!installing}>
        <DialogHeader>
          <DialogTitle>{t('installTitle', { name: getRecommendedSkillText(skill.name, locale) })}</DialogTitle>
          <DialogDescription>{t('installDescription')}</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t('previewError')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <p>{error}</p>
              <Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>{tc('refresh')}</Button>
            </AlertDescription>
          </Alert>
        ) : !preview ? (
          <div className="flex items-center gap-2" role="status"><Spinner />{t('inspecting')}</div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t('files', { count: preview.files.length })}</p>
            {(preview.hasScripts || preview.warnings.length > 0) && (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>{t('warningsTitle')}</AlertTitle>
                <AlertDescription>
                  {preview.hasScripts && <p>{t('scripts')}</p>}
                  {preview.warnings.length > 0 && (
                    <ul className="flex list-inside list-disc flex-col gap-1">
                      {preview.warnings.map((warning, index) => (
                        <li key={`${warning.code}-${index}`}>
                          {tr.has(warning.code) ? tr(warning.code, {
                            actual: warning.actual,
                            recommended: warning.recommended,
                            actualSize: formatBytes(warning.actual),
                            recommendedSize: formatBytes(warning.recommended),
                            count: warning.actual,
                          }) : warning.code}
                        </li>
                      ))}
                    </ul>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
        <FieldGroup>
          <Field data-disabled={installing}>
            <FieldLabel id="recommended-skill-scope">{t('scope')}</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={scope}
              disabled={installing}
              aria-labelledby="recommended-skill-scope"
              className="w-full flex-wrap"
              onValueChange={value => { if (value === 'global' || value === 'project') setScope(value) }}
            >
              <ToggleGroupItem value="global">{ts('global')}</ToggleGroupItem>
              <ToggleGroupItem value="project">{ts('project')}</ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>{ts(scope === 'global' ? 'globalInstallHelp' : 'workspaceInstallHelp')}</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" disabled={installing} onClick={onClose}>{tc('cancel')}</Button>
          <Button disabled={!preview || installing || installed} onClick={() => void handleInstall()}>
            {installing ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            {installing ? t('installing') : installed ? t('installed') : t('install')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
