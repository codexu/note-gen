'use client'

import { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Type } from 'lucide-react'

import {
  getEditorStatistics,
  markdownToPlainText,
  type EditorStatistics,
} from '@/lib/editor-statistics'

interface WordCountProps {
  editor: Editor
  sourceMarkdown?: string
  compact?: boolean
}

const EMPTY_STATISTICS: EditorStatistics = {
  characters: 0,
  readingMinutes: 0,
}
const SOURCE_STATISTICS_DEBOUNCE_MS = 600
const SOURCE_STATISTICS_IDLE_TIMEOUT_MS = 1_500

export function WordCount({ editor, sourceMarkdown, compact = false }: WordCountProps) {
  const t = useTranslations('settings.editor.stats')
  const [statistics, setStatistics] = useState<EditorStatistics>(() => (
    sourceMarkdown === undefined
      ? getEditorStatistics(editor.state.doc.textContent)
      : EMPTY_STATISTICS
  ))

  useEffect(() => {
    if (sourceMarkdown === undefined) return

    let idleCallbackId: number | null = null
    const updateTimer = window.setTimeout(() => {
      const updateStatistics = () => {
        setStatistics(getEditorStatistics(markdownToPlainText(sourceMarkdown)))
      }

      if (typeof window.requestIdleCallback === 'function') {
        idleCallbackId = window.requestIdleCallback(updateStatistics, {
          timeout: SOURCE_STATISTICS_IDLE_TIMEOUT_MS,
        })
      } else {
        updateStatistics()
      }
    }, SOURCE_STATISTICS_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(updateTimer)
      if (idleCallbackId !== null) {
        window.cancelIdleCallback(idleCallbackId)
      }
    }
  }, [sourceMarkdown])

  useEffect(() => {
    if (sourceMarkdown !== undefined) return

    let updateTimer: ReturnType<typeof setTimeout> | null = null

    const updateCharacters = () => {
      if (updateTimer) {
        clearTimeout(updateTimer)
      }

      updateTimer = setTimeout(() => {
        updateTimer = null
        setStatistics(getEditorStatistics(editor.state.doc.textContent))
      }, 400)
    }

    setStatistics(getEditorStatistics(editor.state.doc.textContent))
    editor.on('create', updateCharacters)
    editor.on('update', updateCharacters)

    return () => {
      if (updateTimer) {
        clearTimeout(updateTimer)
      }
      editor.off('create', updateCharacters)
      editor.off('update', updateCharacters)
    }
  }, [editor, sourceMarkdown])

  if (compact) {
    return <span className="flex items-center gap-1 text-xs"><Type className="size-3" />{t('characters', { count: statistics.characters })}</span>
  }

  return (
    <span className="flex items-center gap-1.5 text-xs">
      <Type className="size-3" />
      <span>{t('characters', { count: statistics.characters })}</span>
      <span aria-hidden="true">·</span>
      <span>{t('readingTime', { count: statistics.readingMinutes })}</span>
    </span>
  )
}
