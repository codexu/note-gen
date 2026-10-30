'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CircleAlert } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useSelfHostedNoteConflicts } from '@/hooks/use-self-hosted-note-conflicts'
import { editorPathsReferToSameFile, prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'
import {
  loadSelfHostedNoteConflict,
  resolveSelfHostedNoteConflict,
  type SelfHostedNoteConflictPreview,
  type SelfHostedNoteConflictSummary,
} from '@/lib/self-hosted-sync/conflicts'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { useSelfHostedConflictStore } from '@/stores/self-hosted-conflicts'
import { SelfHostedConflictDialog } from './self-hosted-conflict-dialog'

interface SelfHostedNoteConflictsProps {
  activeFilePath: string
  isActive: boolean
  getMarkdown: () => string
  disabled: boolean
}

interface LoadedConflict {
  preview: SelfHostedNoteConflictPreview
  liveMarkdown: string
  isScopeCurrent: () => boolean
}

export function SelfHostedNoteConflicts({
  activeFilePath,
  isActive,
  getMarkdown,
  disabled,
}: SelfHostedNoteConflictsProps) {
  const t = useTranslations('syncOverview.selfHostedConflict')
  const workspacePath = useSettingStore(state => state.workspacePath)
  const method = useSettingStore(state => state.primaryBackupMethod)
  const { conflicts, refresh } = useSelfHostedNoteConflicts(isActive)
  const requestedId = useSelfHostedConflictStore(state => state.requestedId)
  const clearRequest = useSelfHostedConflictStore(state => state.clearRequest)
  const [selected, setSelected] = useState<SelfHostedNoteConflictSummary | null>(null)
  const [preview, setPreview] = useState<SelfHostedNoteConflictPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mountedRef = useRef(false)
  const generationRef = useRef(0)
  const busyRef = useRef(false)
  const loadedRef = useRef<LoadedConflict | null>(null)
  const scopeRef = useRef({ activeFilePath, isActive, disabled, workspacePath, method, getMarkdown })
  scopeRef.current = { activeFilePath, isActive, disabled, workspacePath, method, getMarkdown }

  const describeError = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (message.includes('SELF_HOSTED_NOTE_CONFLICT_INITIALIZING')) return t('initializing')
    if (message.includes('SELF_HOSTED_NOTE_CONFLICT_CHANGED') || message.includes('_STALE')) return t('stale')
    if (message.includes('SELF_HOSTED_NOTE_CONFLICT_UNAVAILABLE')
      || message.includes('SELF_HOSTED_NOTE_CONFLICT_UNSUPPORTED')) return t('unavailable')
    return cause instanceof Error && cause.message ? cause.message : t('failed')
  }, [t])

  const resetDialog = useCallback(() => {
    generationRef.current++
    loadedRef.current = null
    setSelected(null)
    setPreview(null)
    setLoading(false)
    setError('')
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current++
      loadedRef.current = null
    }
  }, [])

  useEffect(() => {
    resetDialog()
  }, [activeFilePath, disabled, isActive, method, resetDialog, workspacePath])

  const loadConflict = useCallback(async (conflict: SelfHostedNoteConflictSummary) => {
    if (busyRef.current) return
    const scope = scopeRef.current
    if (!scope.isActive || scope.disabled || scope.method !== 'selfHosted'
      || !editorPathsReferToSameFile(conflict.relativePath, scope.activeFilePath, conflict.localRoot)) return

    clearRequest(conflict.id)
    const generation = ++generationRef.current
    const isCurrent = () => {
      const current = scopeRef.current
      const settings = useSettingStore.getState()
      return mountedRef.current && generationRef.current === generation
        && current.isActive && !current.disabled
        && current.activeFilePath === scope.activeFilePath
        && current.workspacePath === scope.workspacePath && current.method === scope.method
        && settings.workspacePath === scope.workspacePath && settings.primaryBackupMethod === scope.method
        && editorPathsReferToSameFile(
          useArticleStore.getState().activeFilePath,
          scope.activeFilePath,
          conflict.localRoot,
        )
    }

    loadedRef.current = null
    setSelected(conflict)
    setPreview(null)
    setError('')
    setLoading(true)
    try {
      // Flush visual-editor serialization before draining its durable save.
      scopeRef.current.getMarkdown()
      if (!await prepareActiveEditorDeactivationDurably(scope.activeFilePath)) {
        throw new Error(t('failed'))
      }
      if (!isCurrent()) return
      await useArticleStore.getState().flushPendingArticleSave(scope.activeFilePath)
      if (!isCurrent()) return
      const liveMarkdown = scopeRef.current.getMarkdown()
      const nextPreview = await loadSelfHostedNoteConflict(conflict.id)
      if (!isCurrent()) return
      if (scopeRef.current.getMarkdown() !== liveMarkdown) {
        throw new Error('SELF_HOSTED_NOTE_CONFLICT_CHANGED')
      }
      loadedRef.current = { preview: nextPreview, liveMarkdown, isScopeCurrent: isCurrent }
      setPreview(nextPreview)
    } catch (cause) {
      if (isCurrent()) {
        const message = describeError(cause)
        setError(message)
        toast({ title: t('failed'), description: message, variant: 'destructive' })
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [clearRequest, describeError, t])

  useEffect(() => {
    if (!requestedId || !isActive || disabled || busy) return
    const requested = conflicts.find(conflict => conflict.id === requestedId
      && editorPathsReferToSameFile(conflict.relativePath, activeFilePath, conflict.localRoot))
    if (requested) void loadConflict(requested)
  }, [activeFilePath, busy, conflicts, disabled, isActive, loadConflict, requestedId])

  const resolve = useCallback(async (content: string) => {
    const loaded = loadedRef.current
    if (!loaded || busyRef.current || !loaded.isScopeCurrent()) return
    const isCurrent = () => loaded.isScopeCurrent()
      && scopeRef.current.getMarkdown() === loaded.liveMarkdown
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      if (!isCurrent()) throw new Error('SELF_HOSTED_NOTE_CONFLICT_CHANGED')
      if (!await prepareActiveEditorDeactivationDurably(scopeRef.current.activeFilePath)) {
        throw new Error(t('failed'))
      }
      if (!isCurrent()) throw new Error('SELF_HOSTED_NOTE_CONFLICT_CHANGED')
      await useArticleStore.getState().flushPendingArticleSave(scopeRef.current.activeFilePath)
      if (!isCurrent()) throw new Error('SELF_HOSTED_NOTE_CONFLICT_CHANGED')
      await resolveSelfHostedNoteConflict(loaded.preview, content, isCurrent)
      // The accepted scoped update changes getMarkdown itself. After success,
      // only the navigation guard applies to dismissing this preview.
      if (loaded.isScopeCurrent()) {
        resetDialog()
        toast({ title: t('resolved') })
      }
      void refresh().catch(cause => {
        console.warn('[self-hosted-sync] Unable to refresh resolved note conflicts', cause)
      })
    } catch (cause) {
      if (loaded.isScopeCurrent()) {
        const message = describeError(cause)
        setError(message)
        toast({ title: t('failed'), description: message, variant: 'destructive' })
      }
    } finally {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }, [describeError, refresh, resetDialog, t])

  if (!isActive || method !== 'selfHosted') return null
  const currentConflict = conflicts.find(conflict => (
    editorPathsReferToSameFile(conflict.relativePath, activeFilePath, conflict.localRoot)
  ))

  return <>
    {currentConflict ? (
      <Alert variant="warning" className="shrink-0 rounded-none border-x-0 border-t-0">
        <CircleAlert aria-hidden="true" />
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('banner')}</span>
          <Button type="button" variant="outline" size="sm" disabled={disabled || busy}
            onClick={() => void loadConflict(currentConflict)}>
            {t('resolve')}
          </Button>
        </AlertDescription>
      </Alert>
    ) : null}
    <SelfHostedConflictDialog
      open={selected !== null}
      onOpenChange={open => { if (!open && !busyRef.current) resetDialog() }}
      relativePath={selected?.relativePath ?? ''}
      localContent={preview?.localContent ?? ''}
      remoteContent={preview?.remoteContent ?? ''}
      loading={loading}
      busy={busy}
      error={error}
      onRefresh={() => { if (selected) void loadConflict(selected) }}
      onResolve={resolve}
    />
  </>
}
