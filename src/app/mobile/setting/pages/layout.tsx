'use client'

import { usePathname, useRouter } from "next/navigation";
import { SwipeBack, type SwipeBackHandle } from "@/components/ui/swipe-back";
import { MobileSettingActionOutlet, SettingLayoutProvider } from "@/app/core/setting/components/setting-base";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { MobileMePage } from "@/app/mobile/setting/components/mobile-me-page";
import { MobileBackButton } from "@/components/mobile-back-button";

const MOBILE_ME_RESTORE_OPEN_KEY = "mobile-me-restore-open"
const MOBILE_ME_RESTORE_INSTANT_KEY = "mobile-me-restore-open-instant"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('common')
  const settingsT = useTranslations('settings')
  const [restoreMeSheet, setRestoreMeSheet] = useState(false)
  const swipeBackRef = useRef<SwipeBackHandle>(null)
  const anchor = pathname.split('/').filter(Boolean).at(-1) ?? ''
  const title = anchor === 'pages'
    ? settingsT('title')
    : anchor === 'ai'
    ? settingsT('ai.menuTitle')
    : settingsT(`${anchor}.title`)

  useEffect(() => {
    setRestoreMeSheet(
      window.sessionStorage.getItem(MOBILE_ME_RESTORE_OPEN_KEY) === "true"
    )
  }, [])

  function handleSwipeBack() {
    if (restoreMeSheet) {
      window.sessionStorage.setItem(MOBILE_ME_RESTORE_OPEN_KEY, "true")
      window.sessionStorage.setItem(MOBILE_ME_RESTORE_INSTANT_KEY, "true")
    }
    router.back()
  }

  return (
    <SettingLayoutProvider mobile>
      <SwipeBack
        ref={swipeBackRef}
        onBack={handleSwipeBack}
        backdrop={restoreMeSheet ? (
          <div className="mobile-setting-backdrop flex h-full w-full">
            <div className="mobile-setting-backdrop-surface relative h-full w-[88vw] max-w-[22.5rem] overflow-hidden border-r shadow-2xl">
              <div className="relative h-full min-h-0 pt-[env(safe-area-inset-top)]">
                <MobileMePage
                  embedded
                  animateEntrance={false}
                  refreshOnMount={false}
                />
              </div>
            </div>
          </div>
        ) : undefined}
      >
        <div className="mobile-setting-screen flex h-full w-full flex-col overflow-y-auto bg-background pt-[calc(3.5rem+env(safe-area-inset-top))]">
          <div className="mobile-setting-header fixed left-0 right-0 top-[env(safe-area-inset-top)] z-10 flex h-14 items-center border-b px-2">
            <MobileBackButton
              onClick={() => swipeBackRef.current?.back()}
              label={t('back')}
            />
            <h1 className="min-w-0 flex-1 truncate text-center text-base font-semibold">
              {title}
            </h1>
            <MobileSettingActionOutlet />
          </div>
          <div className="mx-auto w-full min-w-0 max-w-3xl flex-1 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5 sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            {children}
          </div>
        </div>
      </SwipeBack>
    </SettingLayoutProvider>
  )
}
