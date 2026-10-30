'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { refreshSelfHostedSyncRuntime } from '@/lib/self-hosted-sync/lifecycle'
import { getProfile, updateDomainToggle } from '@/lib/self-hosted-sync/profile'
import { connectedProfileId } from '@/lib/self-hosted-sync/workspaces'

const DOMAINS = ['tags', 'marks', 'conversations', 'messages', 'memories', 'settings', 'attachments'] as const

export function SelfHostedPersonalDataOptions() {
  const t = useTranslations('settings.sync.selfHosted')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const handleProfileStateChange = () => setProfileId(null)
    window.addEventListener('self-hosted-profile-state-changed', handleProfileStateChange)
    void (async () => {
      const nextProfileId = await connectedProfileId()
      if (!nextProfileId) return
      const profile = await getProfile(nextProfileId)
      setProfileId(nextProfileId)
      setToggles(profile?.domainToggles ?? {})
    })().catch(error => {
      toast.error(error instanceof Error ? error.message : t('operationFailed'))
    })
    return () => window.removeEventListener('self-hosted-profile-state-changed', handleProfileStateChange)
  }, [t])

  if (!profileId) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('personalDataTitle')}</CardTitle>
        <CardDescription>{t('personalDataDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">{t('personalDomainDependencyHint')}</p>
        <FieldGroup>
          {DOMAINS.map(domain => {
            const dependency = (domain === 'marks' || domain === 'messages') && toggles.tags === false
              ? 'tags'
              : domain === 'messages' && toggles.conversations === false ? 'conversations' : null
            const paused = dependency !== null
            return <Field key={domain} orientation="horizontal" className="mobile-setting-inline-switch-field" data-disabled={paused || saving}>
              <div className="min-w-0 flex-1">
                <FieldLabel htmlFor={`self-hosted-domain-${domain}`}>{t(`domains.${domain}.title`)}</FieldLabel>
                <FieldDescription>{t(`domains.${domain}.description`)}</FieldDescription>
                {dependency && <FieldDescription>
                  <Badge variant="outline" className="mt-1 h-auto max-w-full whitespace-normal">
                    {t('domainPaused', { dependency: t(`domains.${dependency}.title`) })}
                  </Badge>
                </FieldDescription>}
              </div>
              <Switch
                id={`self-hosted-domain-${domain}`}
                checked={!paused && toggles[domain] !== false}
                disabled={paused || saving}
                onCheckedChange={enabled => void (async () => {
                  setSaving(true)
                  try {
                    setToggles(await updateDomainToggle(profileId, domain, enabled))
                    await refreshSelfHostedSyncRuntime()
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : t('operationFailed'))
                  } finally {
                    setSaving(false)
                  }
                })()}
              />
            </Field>
          })}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
