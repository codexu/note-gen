'use client'

import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { PlatformSwitchProgress } from '@/app/core/setting/sync/components/platform-switch-progress'
import { getActiveOnboardingStep } from '@/app/core/main/editor/onboarding-state'
import { Spinner } from '@/components/ui/spinner'
import type { InitialSetupStep } from '@/lib/initial-setup'
import { cn } from '@/lib/utils'
import { useDesktopOnboardingStore } from '@/stores/desktop-onboarding'
import { useInitialSetupStore } from '@/stores/initial-setup'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { usePlatformSwitchStore } from '@/stores/sync-platform-switch'
import { SetupWelcome } from './setup-welcome'

const loading = () => <div className="grid flex-1 place-items-center"><Spinner /></div>
const SetupWorkspaceStep = dynamic(() => import('./workspace-step').then(module => module.SetupWorkspaceStep), { loading })
const SetupModelStep = dynamic(() => import('./model-step').then(module => module.SetupModelStep), { loading })
const SetupKnowledgeStep = dynamic(() => import('./knowledge-step').then(module => module.SetupKnowledgeStep), { loading })
const SetupSyncStep = dynamic(() => import('./sync-step').then(module => module.SetupSyncStep), { loading })

export function InitialSetupScreen({ ready }: { ready: boolean }) {
  const t = useTranslations('initialSetup')
  const { visible, step: savedStep, focusedStep, hydrate, goTo, closeStep, complete, status } = useInitialSetupStore()
  const step = focusedStep ?? savedStep
  const pathname = usePathname()
  const router = useRouter()
  const mobile = pathname.startsWith('/mobile')
  const desktopPractice = useDesktopOnboardingStore(state => state.progress)
  const settingsOpen = useSettingsDialogStore(state => state.open)
  const settingsSection = useSettingsDialogStore(state => state.activeSection)
  const syncTarget = usePlatformSwitchStore(state => state.platform)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const previousPage = useRef<InitialSetupStep | null>(null)

  useEffect(() => { if (ready) void hydrate() }, [ready, hydrate])
  useEffect(() => {
    if (ready && visible && !mobile) void useDesktopOnboardingStore.getState().hydrate()
  }, [mobile, ready, visible])

  useEffect(() => {
    if (!ready || !visible) {
      previousPage.current = null
      return
    }
    const returning = step === 'welcome' && previousPage.current
      ? document.getElementById(`initial-setup-open-${previousPage.current}`)
      : null
    if (returning) returning.focus()
    else titleRef.current?.focus({ preventScroll: true })
    previousPage.current = step
  }, [ready, visible, step])

  function leaveWelcome(capture: boolean) {
    if (!useInitialSetupStore.getState().visible) return
    if (status === 'pending') void complete()
    else closeStep()

    if (capture) {
      useSettingsDialogStore.getState().closeSettings()
      if (mobile) {
        router.replace('/mobile/record')
        useInitialSetupStore.getState().requestCapture()
      } else {
        useDesktopOnboardingStore.getState().setWelcomeRequested(true)
        router.replace('/core/main')
      }
    } else if (status === 'pending') {
      router.replace(mobile ? '/mobile/writing' : '/core/main')
    }
  }

  function leaveConfiguration() {
    const current = useInitialSetupStore.getState()
    if (!current.visible || (current.focusedStep ?? current.step) !== step) return
    if (focusedStep) closeStep()
    else void goTo('welcome')
  }

  const props = {
    mobile,
    focused: Boolean(focusedStep),
    onBack: leaveConfiguration,
    onNext: leaveConfiguration,
  }
  const practiceStep = desktopPractice && getActiveOnboardingStep(desktopPractice)
  const captureLabel = mobile ? t('welcome.capture')
    : practiceStep && desktopPractice?.steps['create-record'] ? t('welcome.continuePractice')
    : desktopPractice && !practiceStep ? t('welcome.viewPractice')
    : t('welcome.practice')
  const leaveLabel = status === 'pending'
    ? t(mobile ? 'welcome.enter' : 'welcome.enterApp')
    : t('welcome.close')
  const brand = (
    <div className="flex items-center gap-2.5">
      <Image src="/app-icon.png" alt="" width={32} height={32} className="size-8 rounded-lg dark:invert" />
      <span className="text-lg font-semibold tracking-tight">NoteGen</span>
    </div>
  )

  return (
    <>
      {ready && visible && (
        <main aria-labelledby="initial-setup-title" aria-describedby="initial-setup-description"
          className={cn(
            'fixed inset-x-0 bottom-0 z-40 flex min-h-0 flex-col overflow-hidden bg-background text-foreground',
            mobile
              ? 'top-0 h-[var(--mobile-viewport-height,100dvh)] translate-y-[var(--mobile-viewport-offset-top,0px)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'
              : 'top-9',
          )}
          onKeyDown={event => event.stopPropagation()}>
          {step === 'welcome' ? (
            <div className="app-panel-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="m-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-8 sm:gap-8 sm:px-10 sm:py-12">
                <header className="flex sm:justify-center">{brand}</header>
                <SetupWelcome headingRef={titleRef} onCapture={() => leaveWelcome(true)} onLeave={() => leaveWelcome(false)}
                  onConfigure={page => void goTo(page)} captureLabel={captureLabel} leaveLabel={leaveLabel} />
              </div>
            </div>
          ) : (
            <section className="m-auto flex h-full max-h-[52rem] min-h-0 w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10">
              <header className="flex shrink-0 flex-col gap-4 pt-5 pb-4 sm:gap-7 sm:pt-8 sm:pb-6">
                <div className="[@media(max-height:32rem)]:hidden">{brand}</div>
                <div className="flex flex-col gap-2">
                  <h1 ref={titleRef} id="initial-setup-title" tabIndex={-1}
                    className="text-2xl font-semibold tracking-tight outline-none sm:text-3xl">
                    {t(`${step}.title`)}
                  </h1>
                  <p id="initial-setup-description" className="text-sm leading-relaxed text-muted-foreground">{t(`${step}.description`)}</p>
                </div>
              </header>
              {step === 'workspace' && <SetupWorkspaceStep {...props} />}
              {step === 'model' && <SetupModelStep {...props} />}
              {step === 'knowledge' && <SetupKnowledgeStep {...props} />}
              {step === 'sync' && <SetupSyncStep {...props} onDefer={() => {
                if (focusedStep) leaveConfiguration()
                else leaveWelcome(false)
              }} />}
            </section>
          )}
        </main>
      )}
      {ready && <div className={cn('fixed right-4 bottom-12 z-40 max-w-[calc(100vw-2rem)] sm:w-[420px]', !syncTarget && 'hidden')}>
        <PlatformSwitchProgress autoOpen={visible ? step === 'sync' : mobile ? pathname.endsWith('/sync') : settingsOpen && settingsSection === 'sync'} />
      </div>}
    </>
  )
}
