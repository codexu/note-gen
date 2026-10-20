'use client'

import { useState } from 'react'
import { ArrowRight, ExternalLink } from 'lucide-react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'

import {
  getMobilePlatform,
  openMobileUpdatePage,
  type MobilePlatform,
} from '@/app/mobile/components/mobile-update-prompt'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import useSettingStore from '@/stores/setting'
import useUpdateStore from '@/stores/update'

export function MobileUpdateSettings() {
  const t = useTranslations('settings.about')
  const version = useSettingStore((state) => state.version)
  const { ignoreCurrentVersion, mobileUpdate } = useUpdateStore()
  const [currentPlatform] = useState<MobilePlatform | null>(() => getMobilePlatform())

  async function handleUpdate() {
    if (!currentPlatform) return
    await openMobileUpdatePage(currentPlatform)
  }

  if (!mobileUpdate || !currentPlatform) return null

  const actionText = currentPlatform === 'ios' ? t('openTestFlight') : t('openDownloadPage')

  return (
    <>
      <section className="mobile-dock-surface overflow-hidden rounded-[1.35rem] border border-primary/20">
        <div className="flex items-center gap-3 p-4">
          <Image
            src="/app-icon.png"
            alt="NoteGen logo"
            className="size-12 shrink-0 rounded-xl dark:invert"
            width={48}
            height={48}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-none">NoteGen</h2>
              <Badge variant="outline">v{version || '-'}</Badge>
              <ArrowRight className="size-3.5 text-muted-foreground" />
              <Badge className="border-transparent bg-green-600 text-white hover:bg-green-600 dark:bg-green-500 dark:hover:bg-green-500">
                v{mobileUpdate.version}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t('mobileUpdateTitle')}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/20 p-3">
          <Button size="sm" variant="ghost" onClick={() => void ignoreCurrentVersion()}>
            {t('ignoreVersion')}
          </Button>
          <Button size="sm" onClick={() => void handleUpdate()}>
            <ExternalLink data-icon="inline-start" />
            {actionText}
          </Button>
        </div>
      </section>
    </>
  )
}
