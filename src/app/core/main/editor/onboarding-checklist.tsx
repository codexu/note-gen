'use client'

import { ArrowRight, Check, CircleCheck, FileText, Languages, PencilLine } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { getActiveOnboardingStep, ONBOARDING_STEP_ORDER, type OnboardingProgress } from './onboarding-state'

const STEPS = {
  'create-record': { copy: 'createRecord', icon: PencilLine },
  'organize-note': { copy: 'organizeNote', icon: FileText },
  'ai-polish': { copy: 'aiPolish', icon: Languages },
} as const

interface OnboardingChecklistProps {
  progress: OnboardingProgress | null
  actionLabel: string
  notice?: string
  busy: boolean
  onStart: () => void | Promise<void>
}

export function OnboardingChecklist({ progress, actionLabel, notice, busy, onStart }: OnboardingChecklistProps) {
  const t = useTranslations('article.emptyState.onboarding')
  const common = useTranslations('common')
  const currentStep = progress && getActiveOnboardingStep(progress)
  const currentCopy = currentStep ? STEPS[currentStep].copy : null
  const completedCount = progress ? ONBOARDING_STEP_ORDER.filter(step => progress.steps[step]).length : 0

  return (
    <Card className="@container/practice [--card-spacing:--spacing(5)]">
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 data-onboarding-checklist tabIndex={-1} className="font-heading text-base font-semibold tracking-tight outline-none">
          {t('title')}
        </h2>
        {progress && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {t('progress', { completed: completedCount, total: ONBOARDING_STEP_ORDER.length })}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {progress ? (
          <ol role="list" className="grid grid-cols-3 gap-2 @sm/practice:gap-3">
            {ONBOARDING_STEP_ORDER.map(step => {
              const complete = progress.steps[step]
              const current = currentStep === step
              const { copy, icon: StepIcon } = STEPS[step]
              const Icon = complete ? Check : StepIcon
              return (
                <li
                  key={step}
                  aria-current={current ? 'step' : undefined}
                  className="flex min-w-0 flex-col gap-2"
                >
                  <div
                    aria-hidden="true"
                    className={cn('h-1 rounded-full', complete ? 'bg-primary' : current ? 'bg-primary/45' : 'bg-muted')}
                  />
                  <div className={cn(
                    'flex min-w-0 flex-col items-start gap-x-1.5 gap-y-1 rounded-lg px-1.5 py-1.5 text-xs @sm/practice:flex-row @sm/practice:items-center @sm/practice:px-2.5',
                    current ? 'bg-primary/8 font-semibold text-foreground' : 'text-muted-foreground',
                  )}>
                    <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', complete && 'text-success-foreground')} />
                    <span className="min-w-0 wrap-anywhere">{t(`steps.${copy}.shortTitle`)}</span>
                    <span className="sr-only">
                      {t(complete ? 'completed' : current ? 'status.current' : 'status.pending')}
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner aria-hidden="true" />{common('loading')}
          </p>
        )}
      </CardContent>

      {progress && (
        <CardFooter className="flex-col items-start gap-3 @lg/practice:flex-row @lg/practice:items-center @lg/practice:justify-between @lg/practice:gap-5">
          {currentCopy ? (
            <>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="text-sm leading-snug font-semibold">{t(`steps.${currentCopy}.title`)}</h3>
                <p className="text-sm leading-snug text-muted-foreground">{t(`steps.${currentCopy}.desc`)}</p>
                {notice && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{notice}</p>}
              </div>
              {actionLabel && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void onStart()}
                  className="h-auto min-h-8 max-w-full shrink-0 py-1.5 text-start whitespace-normal @lg/practice:max-w-[45%]"
                >
                  {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
                  {actionLabel}
                  {!busy && <ArrowRight data-icon="inline-end" aria-hidden="true" />}
                </Button>
              )}
            </>
          ) : (
            <p role="status" className="flex items-start gap-2 text-sm leading-snug text-muted-foreground">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success-foreground" />
              {t('allDone')}
            </p>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
