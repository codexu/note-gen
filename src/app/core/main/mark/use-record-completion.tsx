'use client'

import { EmitterRecordEvents } from '@/config/emitters'
import { getMarkById } from '@/db/marks'
import { toast } from '@/hooks/use-toast'
import emitter from '@/lib/emitter'
import { handleRecordComplete } from '@/lib/record-navigation'
import { createRecordTab } from '@/app/core/main/mark/mark-record-tab'
import useArticleStore from '@/stores/article'
import useMarkStore from '@/stores/mark'
import useSettingStore from '@/stores/setting'
import { useSidebarStore } from '@/stores/sidebar'
import useTagStore from '@/stores/tag'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useCallback } from 'react'

interface CompleteRecordOptions {
  markId?: number | null
  tagId?: number | null
  typeLabel?: string
  background?: boolean
}

export function useRecordCompletion() {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations()
  const { fetchMarks, fetchMarkPreviews, setPendingScrollMarkId, setHighlightedMarkId } = useMarkStore()
  const { fetchTags, getCurrentTag, setCurrentTagId } = useTagStore()

  const refreshRecords = useCallback(async (tagId?: number | null, selectTarget = false) => {
    if (selectTarget && tagId) {
      await setCurrentTagId(tagId)
    }

    await fetchTags()
    getCurrentTag()
    if (pathname.startsWith('/mobile')) {
      await fetchMarkPreviews()
    } else {
      await fetchMarks()
    }
    emitter.emit(EmitterRecordEvents.refreshMarks)
  }, [fetchMarkPreviews, fetchMarks, fetchTags, getCurrentTag, pathname, setCurrentTagId])

  const highlightSavedRecord = useCallback(async (markId?: number | null, tagId?: number | null) => {
    await refreshRecords(tagId, true)
    handleRecordComplete(router)

    if (markId) {
      setPendingScrollMarkId(markId)
      setHighlightedMarkId(markId)
    }
  }, [refreshRecords, router, setHighlightedMarkId, setPendingScrollMarkId])

  const openRecordDetail = useCallback(async (markId: number, tagId?: number | null) => {
    await refreshRecords(tagId, true)

    if (pathname.startsWith('/mobile')) {
      router.push(`/mobile/record/detail?id=${markId}`)
      return
    }

    handleRecordComplete(router)
    const mark = await getMarkById(markId)
    if (!mark) {
      return
    }

    const articleState = useArticleStore.getState()
    const recordTab = createRecordTab(mark, t(`record.mark.type.${mark.type}`))
    const existingTab = articleState.openTabs.find((tab) => tab.path === recordTab.path)

    useMarkStore.getState().setActiveMarkId(markId)
    if (existingTab) {
      await articleState.setActiveTabId(existingTab.id)
    } else {
      await articleState.addTab(recordTab)
    }
    await articleState.setActiveFilePath('')
    await useSidebarStore.getState().showCenterPanel()
  }, [pathname, refreshRecords, router, t])

  return useCallback(async ({ markId, tagId, typeLabel, background = false }: CompleteRecordOptions = {}) => {
    if (tagId) {
      await useSettingStore.getState().setLastRecordTagId(tagId)
    }

    // Captures made over other apps only refresh data. Opening a record or
    // changing editor tabs here can activate the main window through its effects.
    if (background) {
      await refreshRecords()
      return
    }

    const completionBehavior = useSettingStore.getState().recordCompletionBehavior
    if (completionBehavior === 'stay') {
      await refreshRecords()
    } else if (completionBehavior === 'open' && markId) {
      await openRecordDetail(markId, tagId)
    } else {
      await highlightSavedRecord(markId, tagId)
    }
    
    const tagName = tagId
      ? useTagStore.getState().tags.find((tag) => tag.id === tagId)?.name
      : undefined
    const savedDescription = typeLabel
      ? t('record.capture.savedWithType', { type: typeLabel })
      : undefined

    toast({
      title: t('record.capture.saved'),
      description: tagName
        ? `${savedDescription || t('record.capture.saved')} · ${t('record.capture.saveTarget')}: ${tagName}`
        : savedDescription,
      action: markId ? {
        label: t('record.capture.viewRecord'),
        onClick: () => {
          void openRecordDetail(markId, tagId)
        },
      } : undefined,
    })
  }, [highlightSavedRecord, openRecordDetail, refreshRecords, t])
}
