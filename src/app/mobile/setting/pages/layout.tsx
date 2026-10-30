'use client'

import { usePathname, useRouter } from "next/navigation";
import { SwipeBack, type SwipeBackHandle } from "@/components/ui/swipe-back";
import { MobileSettingActionOutlet, SettingLayoutProvider } from "@/app/core/setting/components/setting-base";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
import { MobileBackButton } from "@/components/mobile-back-button";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('common')
  const settingsT = useTranslations('settings')
  const swipeBackRef = useRef<SwipeBackHandle>(null)
  const anchor = pathname.split('/').filter(Boolean).at(-1) ?? ''
  const title = anchor === 'pages'
    ? settingsT('title')
    : anchor === 'ai'
    ? settingsT('ai.menuTitle')
    : settingsT(`${anchor}.title`)

  const handleSwipeBack = useCallback(() => {
    const returnUrl = window.sessionStorage.getItem('mobile-me-return-url')
    const restoreSheet = window.sessionStorage.getItem('mobile-me-restore-open') === 'true'
    if (restoreSheet && returnUrl?.startsWith('/mobile/') && !returnUrl.startsWith('/mobile/setting')) {
      window.sessionStorage.setItem('mobile-me-restore-open-instant', 'true')
      router.replace(returnUrl)
      return
    }
    router.replace('/mobile/setting')
  }, [router])

  useEffect(() => {
    window.addEventListener('popstate', handleSwipeBack)
    return () => window.removeEventListener('popstate', handleSwipeBack)
  }, [handleSwipeBack])

  return (
    <SettingLayoutProvider mobile>
      <SwipeBack
        ref={swipeBackRef}
        onBack={handleSwipeBack}
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
