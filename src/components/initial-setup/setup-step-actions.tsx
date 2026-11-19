'use client'

import { ArrowLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'

export interface SetupStepProps {
  onNext: () => void
  onBack: () => void
  focused: boolean
  mobile: boolean
}

interface SetupStepActionsProps {
  onBack: () => void
  onNext: () => void
  nextLabel: string
  busy?: boolean
  disableNext?: boolean
}

export function SetupStepActions({ onBack, onNext, nextLabel, busy, disableNext }: SetupStepActionsProps) {
  const t = useTranslations('initialSetup')
  return (
    <footer className="shrink-0">
      <Separator />
      <div className="flex items-center justify-between gap-3 py-4">
        <Button type="button" variant="ghost" size="lg" className="h-11" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />{t('back')}
        </Button>
        <Button type="button" size="lg" className="h-11 px-5" disabled={busy || disableNext} onClick={onNext}>
          {busy && <Spinner aria-hidden="true" data-icon="inline-start" />}{nextLabel}
        </Button>
      </div>
    </footer>
  )
}
