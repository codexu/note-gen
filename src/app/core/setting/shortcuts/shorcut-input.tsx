'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RotateCcw, TrashIcon } from 'lucide-react'
import { TooltipButton } from '@/components/tooltip-button'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import useShortcutStore, { ShortcutUpdateError } from '@/stores/shortcut'
import useEditorShortcutStore from '@/stores/editor-shortcut'
import { globalShortcutFromKeyboardEvent, globalShortcutIdentity } from '@/lib/global-shortcut'

export default function ShortcutsInput({ name, disabled }: { name: string; disabled?: boolean }) {
  const t = useTranslations('settings.shortcuts')
  const { shortcuts, setShortcut, resetDefault, registrationErrors, setRecordingShortcut } = useShortcutStore()
  const editorShortcuts = useEditorShortcutStore((state) => state.shortcuts)
  const [isRecording, setIsRecording] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const pendingRef = useRef(false)
  const inputRef = useRef<HTMLButtonElement>(null)
  const descriptionId = useId()
  const shortcut = useMemo(() => shortcuts.find((item) => item.key === name), [name, shortcuts])
  const keyGroup = (shortcut?.value ?? '').split('+').filter(Boolean)
  const errorMessage = error || (registrationErrors[name] ? t(registrationErrors[name]) : '')

  useEffect(() => () => {
    if (useShortcutStore.getState().recordingShortcut === name) setRecordingShortcut(null)
  }, [name, setRecordingShortcut])

  useEffect(() => {
    if (!isRecording) return
    const stopRecording = () => {
      inputRef.current?.blur()
      setIsRecording(false)
      if (useShortcutStore.getState().recordingShortcut === name) setRecordingShortcut(null)
    }
    window.addEventListener('blur', stopRecording)
    return () => window.removeEventListener('blur', stopRecording)
  }, [isRecording, name, setRecordingShortcut])

  async function updateShortcut(value: string, reset = false) {
    if (pendingRef.current) return
    const editorConflict = value ? editorShortcuts.find((item) => (
      globalShortcutIdentity(item.value) === globalShortcutIdentity(value)
    )) : undefined
    if (editorConflict) {
      setError(t('conflictEditor', { name: t(`editorShortcuts.commands.${editorConflict.id}.title`) }))
      return
    }

    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      if (reset) await resetDefault(name)
      else await setShortcut(name, value)
    } catch (error) {
      if (error instanceof ShortcutUpdateError) {
        setError(error.conflictKey
          ? t('conflictGlobal', { name: t(`shortcuts.${error.conflictKey}.title`) })
          : t(error.code))
      } else {
        console.error('Failed to save shortcut:', error)
        setError(t('saveFailed'))
      }
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  async function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!isRecording || event.repeat) return
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      inputRef.current?.blur()
      return
    }
    const value = globalShortcutFromKeyboardEvent(event.nativeEvent)
    if (value) await updateShortcut(value)
    else if (!['Alt', 'Control', 'Meta', 'Shift'].includes(event.key) && !event.nativeEvent.isComposing) {
      setError(t('invalidShortcut'))
    }
  }

  function renderKey(key: string) {
    const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
    if (key === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
    if (key === 'Super') return isMac ? '⌘' : 'Super'
    if (key === 'Control') return 'Ctrl'
    if (key === 'Alt') return isMac ? '⌥' : 'Alt'
    return key
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          ref={inputRef}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={t(`shortcuts.${name}.title`)}
          aria-pressed={isRecording}
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={isRecording || errorMessage ? descriptionId : undefined}
          aria-busy={pending}
          onFocus={() => {
            setIsRecording(true)
            setRecordingShortcut(name)
          }}
          onBlur={() => {
            setIsRecording(false)
            setRecordingShortcut(null)
          }}
          onKeyDown={handleKeyDown}
          className="h-auto min-h-9 min-w-40 justify-start whitespace-normal"
        >
          <span className="flex flex-wrap items-center gap-1">
            {keyGroup.length ? keyGroup.map((key) => (
              <Badge key={key} variant="secondary" className="h-6">{renderKey(key)}</Badge>
            )) : <Badge variant="secondary" className="h-6">{t('noShortcut')}</Badge>}
          </span>
        </Button>
        <TooltipButton
          size="icon"
          variant="ghost"
          disabled={disabled || pending}
          tooltipText={t('resetDefaults')}
          onClick={() => { void updateShortcut('', true) }}
          icon={<RotateCcw />}
        />
        <TooltipButton
          size="icon"
          variant="destructive"
          disabled={disabled || pending}
          tooltipText={t('clear')}
          onClick={() => { void updateShortcut('') }}
          icon={<TrashIcon />}
        />
      </div>
      <div id={descriptionId} aria-live="polite" className="max-w-64 text-right text-xs">
        {isRecording && <p className="text-muted-foreground">{t('recording')}</p>}
        {errorMessage && <p className="text-destructive">{errorMessage}</p>}
      </div>
    </div>
  )
}
