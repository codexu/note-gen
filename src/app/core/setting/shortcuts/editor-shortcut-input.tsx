'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, TrashIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { TooltipButton } from '@/components/tooltip-button'
import useEditorShortcutStore from '@/stores/editor-shortcut'
import useShortcutStore from '@/stores/shortcut'
import type { EditorShortcutCommandId } from '@/config/editor-shortcuts'
import {
  formatShortcutForDisplay,
  getShortcutConflict,
  normalizeShortcut,
  shortcutFromKeyboardEvent,
} from '@/lib/editor-shortcut-utils'
import { cn } from '@/lib/utils'

interface EditorShortcutInputProps {
  id: EditorShortcutCommandId
}

function renderShortcutKey(key: string) {
  switch (key) {
    case 'Mod':
      return 'Mod'
    case 'Shift':
      return 'Shift'
    case 'Alt':
      return 'Alt'
    case 'Backspace':
      return 'Backspace'
    case 'Escape':
      return 'Esc'
    default:
      return key
  }
}

export function EditorShortcutInput({ id }: EditorShortcutInputProps) {
  const t = useTranslations('settings.shortcuts')
  const shortcuts = useEditorShortcutStore((state) => state.shortcuts)
  const setEditorShortcut = useEditorShortcutStore((state) => state.setEditorShortcut)
  const resetEditorShortcut = useEditorShortcutStore((state) => state.resetEditorShortcut)
  const globalShortcuts = useShortcutStore((state) => state.shortcuts)
  const inputRef = useRef<HTMLDivElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [draftValue, setDraftValue] = useState('')
  const [rejectedValue, setRejectedValue] = useState('')

  const shortcut = useMemo(() => {
    return shortcuts.find((item) => item.id === id)
  }, [id, shortcuts])

  const value = isRecording ? draftValue : shortcut?.value ?? ''
  const keyGroup = formatShortcutForDisplay(value)
  const editorConflict = getShortcutConflict(shortcuts, id, rejectedValue)
  const globalConflict = globalShortcuts.find((item) => (
    rejectedValue &&
    normalizeShortcut(item.value) === normalizeShortcut(rejectedValue)
  ))
  const rejected = Boolean(editorConflict || globalConflict)

  useEffect(() => {
    if (!isRecording) {
      setDraftValue(shortcut?.value ?? '')
      setRejectedValue('')
    }
  }, [isRecording, shortcut?.value])

  async function commitShortcut(valueToCommit: string) {
    const normalizedValue = normalizeShortcut(valueToCommit)

    if (globalShortcuts.some((item) => normalizeShortcut(item.value) === normalizedValue)) {
      setRejectedValue(normalizedValue)
      return
    }

    const saved = await setEditorShortcut(id, normalizedValue)
    if (!saved) {
      setRejectedValue(normalizedValue)
      return
    }

    setRejectedValue('')
    setDraftValue(normalizedValue)
  }

  async function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!isRecording) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const nextValue = shortcutFromKeyboardEvent(event.nativeEvent)
    if (!nextValue) {
      return
    }

    setDraftValue(nextValue)
    await commitShortcut(nextValue)
  }

  function handleFocus() {
    setIsRecording(true)
    setDraftValue(shortcut?.value ?? '')
  }

  function handleBlur() {
    setIsRecording(false)
  }

  async function handleResetDefault() {
    await resetEditorShortcut(id)
  }

  async function handleClear() {
    setRejectedValue('')
    setDraftValue('')
    await setEditorShortcut(id, '')
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <div
          ref={inputRef}
          role="button"
          tabIndex={0}
          onClick={handleFocus}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={cn(
            'flex min-h-9 min-w-40 cursor-pointer items-center rounded-md border px-2 py-1 outline-none',
            isRecording ? 'border-primary' : 'border-transparent',
            rejected && 'border-destructive',
          )}
        >
          <div className="flex flex-wrap items-center gap-1">
            {keyGroup.length > 0 ? (
              keyGroup.map((key) => (
                <Badge key={key} variant="secondary" className="h-6">
                  {renderShortcutKey(key)}
                </Badge>
              ))
            ) : (
              <Badge variant="secondary" className="h-6">
                {t('noShortcut')}
              </Badge>
            )}
          </div>
        </div>
        <TooltipButton
          size="icon"
          variant="ghost"
          tooltipText={t('resetDefaults')}
          onClick={handleResetDefault}
          icon={<RotateCcw />}
        />
        <TooltipButton
          size="icon"
          variant="destructive"
          tooltipText={t('clear')}
          onClick={handleClear}
          icon={<TrashIcon />}
        />
      </div>
      {isRecording && (
        <p className="text-xs text-muted-foreground">
          {t('recording')}
        </p>
      )}
      {rejected && (
        <p className="max-w-64 text-right text-xs text-destructive">
          {editorConflict
            ? t('conflictEditor', { name: t(`editorShortcuts.commands.${editorConflict.id}.title`) })
            : t('conflictGlobal', { name: globalConflict ? t(`shortcuts.${globalConflict.key}.title`) : '' })}
        </p>
      )}
    </div>
  )
}

export default EditorShortcutInput
