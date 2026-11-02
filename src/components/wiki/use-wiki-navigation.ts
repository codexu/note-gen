'use client'

import { useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { useWikiErrorMessage } from './use-wiki-error-message'
import { openWikiPage } from './wiki-source-actions'
import { captureWikiWorkspaceGuard } from '@/lib/wiki/context'

export function useWikiNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()

  const openPage = useCallback(async (pageId?: string, expectedContextId?: string) => {
    const isCurrent = captureWikiWorkspaceGuard()
    try {
      const route = await openWikiPage(pageId, pathname.startsWith('/mobile'), expectedContextId)
      if (!isCurrent()) return
      if (!route) {
        toast.error(t('loadFailed'))
        return
      }
      useSettingsDialogStore.getState().closeSettings()
      router.push(route)
    } catch (error) {
      if (isCurrent()) toast.error(t('loadFailed'), { description: errorMessage(error) })
    }
  }, [errorMessage, pathname, router, t])

  const openFolder = useCallback((expectedContextId?: string) => openPage(undefined, expectedContextId), [openPage])
  return { openPage, openFolder }
}
