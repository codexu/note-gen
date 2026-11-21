'use client'

import { ListChecks } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { usePlatformSwitchStore, useSelfHostedSetupReturnStore } from '@/stores/sync-platform-switch'

export function PendingSelfHostedSetup({ profileId, className, onContinue }: {
  profileId: string
  className?: string
  onContinue?: () => void
}) {
  const t = useTranslations('syncOverview.selfHostedStatus')
  const continueLabel = useTranslations('settings.sync.selfHosted')('continueSetup')
  const switchLocked = usePlatformSwitchStore(state => state.platform !== null
    && (state.platform !== 'selfHosted' || state.mutated || state.skipped || state.cancelledHidden
      || !['completed', 'cancelled', 'error'].includes(state.step)))

  return (
    <Alert variant="warning" role="status" className={className}>
      <ListChecks aria-hidden="true" />
      <AlertTitle>{t('confirmationRequired')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{t('confirmationHint')}</span>
        <Button type="button" variant="outline" className="min-h-11 max-w-full whitespace-normal" disabled={switchLocked} onClick={() => {
          useSelfHostedSetupReturnStore.setState({ request: { profileId, intent: 'setup' } })
          onContinue?.()
        }}>{continueLabel}</Button>
      </AlertDescription>
    </Alert>
  )
}
