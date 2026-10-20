'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { refreshSelfHostedSyncRuntime } from '@/lib/self-hosted-sync/lifecycle'
import { getProfile, updateDomainToggle } from '@/lib/self-hosted-sync/profile'
import { connectedProfileId } from '@/lib/self-hosted-sync/workspaces'

const DOMAINS = ['tags', 'marks', 'conversations', 'messages', 'memories', 'settings', 'attachments'] as const

export function SelfHostedPersonalDataOptions() {
  const t = useTranslations('settings.sync.selfHosted')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [toggles, setToggles] = useState<Record<string, boolean>>({})

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
        <FieldGroup>
          {DOMAINS.map(domain => (
            <Field key={domain} orientation="horizontal">
              <div className="flex-1">
                <FieldLabel htmlFor={`self-hosted-domain-${domain}`}>{t(`domains.${domain}.title`)}</FieldLabel>
                <FieldDescription>{t(`domains.${domain}.description`)}</FieldDescription>
              </div>
              <Switch
                id={`self-hosted-domain-${domain}`}
                checked={toggles[domain] !== false}
                onCheckedChange={enabled => void (async () => {
                  setToggles(await updateDomainToggle(profileId, domain, enabled))
                  await refreshSelfHostedSyncRuntime()
                })().catch(error => {
                  toast.error(error instanceof Error ? error.message : t('operationFailed'))
                })}
              />
            </Field>
          ))}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
