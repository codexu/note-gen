'use client'

import { useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { useWikiErrorMessage } from './use-wiki-error-message'
import { openWikiConflictFile, openWikiFolder, openWikiPage } from './wiki-source-actions'
import { captureWikiWorkspaceGuard } from '@/lib/wiki/context'

export function useWikiNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()

  const mobile = pathname.startsWith('/mobile')
  const navigate = useCallback(async (resolve: () => Promise<string | null>, onOpened?: () => void) => {
    const isCurrent = captureWikiWorkspaceGuard()
    try {
      const route = await resolve()
      if (!isCurrent()) return
      if (!route) {
        toast.error(t('loadFailed'))
        return
      }
      useSettingsDialogStore.getState().closeSettings()
      router.push(route)
      onOpened?.()
    } catch (error) {
      if (isCurrent()) toast.error(t('loadFailed'), { description: errorMessage(error) })
    }
  }, [errorMessage, router, t])

  const openPage = useCallback((pageId?: string, expectedContextId?: string, pageVersion?: string, onOpened?: () => void) =>
    navigate(() => openWikiPage(pageId, mobile, expectedContextId, pageVersion), onOpened), [navigate, mobile])
  const openFolder = useCallback((expectedContextId?: string) =>
    navigate(() => openWikiFolder(mobile, expectedContextId)), [navigate, mobile])
  const openConflictFile = useCallback((path: string, expectedContextId: string) =>
    navigate(() => openWikiConflictFile(path, mobile, expectedContextId)), [navigate, mobile])
  return { openPage, openFolder, openConflictFile }
}
