'use client'

import { useEffect, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { refreshSelfHostedSyncRuntime } from '@/lib/self-hosted-sync/lifecycle'
import { getProfile, updateDomainToggle, type SelfHostedProfile } from '@/lib/self-hosted-sync/profile'
import { connectedProfileId } from '@/lib/self-hosted-sync/workspaces'
import { cn } from '@/lib/utils'

const DOMAINS = ['tags', 'marks', 'conversations', 'messages', 'memories', 'settings', 'attachments'] as const

export function SelfHostedPersonalDataOptions({ targetProfileId, onChanged, onSavingChange, onReadyChange, embedded = false }: {
  targetProfileId?: string | null
  onChanged?: (toggles: Record<string, boolean>) => void
  onSavingChange?: (saving: boolean) => void
  onReadyChange?: (ready: boolean) => void
  embedded?: boolean
} = {}) {
  const t = useTranslations('settings.sync.selfHosted')
  const id = useId()
  const [profile, setProfile] = useState<SelfHostedProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let generation = 0
    const handleProfileStateChange = () => {
      const request = ++generation
      setLoadState('loading')
      onReadyChange?.(false)
      void (async () => {
        const profileId = targetProfileId === undefined ? await connectedProfileId() : targetProfileId
        const next = profileId ? await getProfile(profileId) : null
        if (request !== generation) return
        const valid = next?.state === 'connected' || next?.state === 'pending-review' ? next : null
        setProfile(valid)
        setLoadState(valid ? 'ready' : 'error')
        onReadyChange?.(Boolean(valid))
      })().catch(error => {
        if (request !== generation) return
        setProfile(null)
        setLoadState('error')
        if (!embedded) toast.error(error instanceof Error ? error.message : t('operationFailed'))
      })
    }
    window.addEventListener('self-hosted-profile-state-changed', handleProfileStateChange)
    handleProfileStateChange()
    return () => {
      generation++
      window.removeEventListener('self-hosted-profile-state-changed', handleProfileStateChange)
    }
  }, [embedded, onReadyChange, revision, t, targetProfileId])

  if (loadState !== 'ready' || !profile || (targetProfileId !== undefined && targetProfileId !== profile.id)) {
    if (!embedded) return null
    return <Field>
      <p className="text-sm font-medium">{t('personalDataTitle')}</p>
      {loadState === 'error' ? <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-destructive" role="alert">{t('personalDataLoadFailed')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>{t('initialLibraryRetry')}</Button>
      </div> : <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner />{t('personalDataLoading')}</p>}
    </Field>
  }
  const { id: profileId, state, domainToggles: toggles } = profile
  const domainOptions = DOMAINS.map(domain => ({
    domain,
    dependency: (domain === 'marks' || domain === 'messages') && toggles.tags === false
      ? 'tags' as const
      : domain === 'messages' && toggles.conversations === false ? 'conversations' as const : null,
  }))
  const enabledCount = domainOptions.filter(({ domain, dependency }) => !dependency && toggles[domain] !== false).length

  async function saveDomain(domain: typeof DOMAINS[number], enabled: boolean) {
    setSaving(true)
    onSavingChange?.(true)
    try {
      const next = await updateDomainToggle(profileId, domain, enabled)
      setProfile(current => current?.id === profileId ? { ...current, domainToggles: next } : current)
      onChanged?.(next)
      if (state === 'connected') await refreshSelfHostedSyncRuntime()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setSaving(false)
      onSavingChange?.(false)
    }
  }

  const fields = <>
    <p className="mb-4 text-sm text-muted-foreground">{t('personalDomainDependencyHint')}</p>
    <FieldGroup>
      {domainOptions.map(({ domain, dependency }) => {
        const paused = dependency !== null
        return <Field key={domain} orientation="horizontal" className="mobile-setting-inline-switch-field" data-disabled={paused || saving}>
          <div className="min-w-0 flex-1">
            <FieldLabel htmlFor={`${id}-${domain}`}>{t(`domains.${domain}.title`)}</FieldLabel>
            <FieldDescription>{t(`domains.${domain}.description`)}</FieldDescription>
            {dependency && <FieldDescription>
              <Badge variant="outline" className="mt-1 h-auto max-w-full whitespace-normal">
                {t('domainPaused', { dependency: t(`domains.${dependency}.title`) })}
              </Badge>
            </FieldDescription>}
          </div>
          <Switch
            id={`${id}-${domain}`}
            checked={!paused && toggles[domain] !== false}
            disabled={paused || saving}
            onCheckedChange={enabled => void saveDomain(domain, enabled)}
          />
        </Field>
      })}
    </FieldGroup>
  </>

  const trigger = (
    <AccordionTrigger className="gap-3 p-0 hover:no-underline"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
      <span className="flex min-w-0 flex-col gap-1">
        <span id={`${id}-title`} className={cn(!embedded && 'font-heading text-base leading-snug')}>
          {t('personalDataTitle')}
          {embedded && <> · {t('personalDataEnabledCount', { enabled: enabledCount, total: DOMAINS.length })}</>}
        </span>
        <span id={`${id}-description`} className="font-normal text-muted-foreground">
          {t('personalDataDescription')}
        </span>
      </span>
    </AccordionTrigger>
  )

  const panel = (
    <Accordion type="single" collapsible className="min-w-0">
      <AccordionItem value="personal-data">
        {embedded ? trigger : <CardHeader>{trigger}</CardHeader>}
        <AccordionContent className={embedded ? 'pt-3' : 'pb-0'}>
          {embedded ? fields : <CardContent className="pt-4">{fields}</CardContent>}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )

  return embedded ? panel : <Card>{panel}</Card>
}
