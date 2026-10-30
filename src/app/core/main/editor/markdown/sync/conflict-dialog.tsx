'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import { Editor } from '@tiptap/react'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
} from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import { SyncContentComparison } from '@/components/sync-content-comparison'
import { Spinner } from '@/components/ui/spinner'
import { X } from 'lucide-react'
import { setLocalRecordedSha } from '@/lib/sync/auto-sync'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { getFilePathOptions } from '@/lib/workspace'
import { getSyncMetadataKey } from '@/lib/sync/sync-context'
import { readVersionedWorkspaceFile, uploadGuardedWorkspaceFile, type WorkspaceRemotePlatform } from '@/lib/sync/guarded-workspace-upload'
import { prepareActiveEditorDeactivationDurably } from '@/lib/editor-deactivation'
import { syncStaleError } from '@/lib/sync/sync-stale-error'
import { captureWorkspaceRemoteWriteGuard } from '@/lib/sync/workspace-remote-write-guard'
import { generateGitSyncCommitMessage } from '@/lib/sync/commit-message'
import { collectLocalMarkdownImagePaths } from '@/lib/markdown-media-path'
import { enqueueStaticAssetSync, flushPendingStaticAssetSync } from '@/lib/sync/static-asset-sync-queue'
import { updateFileSyncTime } from '@/lib/sync/conflict-resolution'
import emitter from '@/lib/emitter'
import useArticleStore from '@/stores/article'

interface ConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeFilePath: string | null
  editor: Editor
  localMarkdown?: string
  getMarkdown?: () => string
  prepareExternalAction?: () => boolean
  isScopeCurrent: () => boolean
  onKeepRemote: (remote: { content: string; version: string }, localSnapshot: string) => Promise<boolean>
  onResolved: () => void
}

export function ConflictDialog({
  open,
  onOpenChange,
  activeFilePath,
  editor,
  localMarkdown,
  getMarkdown,
  prepareExternalAction,
  isScopeCurrent,
  onKeepRemote,
  onResolved,
}: ConflictDialogProps) {
  const t = useTranslations('syncOverview.document')
  const c = useTranslations('syncOverview.selfHostedConflict')
  const [preview, setPreview] = useState<{
    content: string
    version: string
    localContent: string
    platform: WorkspaceRemotePlatform
    workspacePath: string
    metadataKey: string
    absolutePath: string
  } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const mountedRef = useRef(false)
  const operationRef = useRef(false)
  const callbacksRef = useRef({ getMarkdown, localMarkdown, prepareExternalAction, isScopeCurrent, onKeepRemote })
  callbacksRef.current = { getMarkdown, localMarkdown, prepareExternalAction, isScopeCurrent, onKeepRemote }
  const openRef = useRef(open)
  openRef.current = open
  const readMarkdown = () => callbacksRef.current.getMarkdown?.()
    ?? callbacksRef.current.localMarkdown
    ?? editor.getMarkdown()
  const isCurrent = useCallback(() => mountedRef.current && openRef.current
    && useArticleStore.getState().activeFilePath === activeFilePath
    && callbacksRef.current.isScopeCurrent(), [activeFilePath])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!open || !activeFilePath) return
    let cancelled = false
    setPreview(null)
    setIsLoading(true)
    const current = () => !cancelled && isCurrent()
    const fetchContents = async () => {
      try {
        const { primaryBackupMethod: platform, workspacePath } = useSettingStore.getState()
        if (platform === 'local' || platform === 'selfHosted' || !current()) return
        const pathOptions = await getFilePathOptions(activeFilePath)
        const absolutePath = pathOptions.baseDir === undefined
          ? pathOptions.path : await join(await appDataDir(), pathOptions.path)
        if (!current()) return
        const metadataKey = await getSyncMetadataKey(activeFilePath, platform)
        if (!current()) return
        const remote = await readVersionedWorkspaceFile(activeFilePath, platform)
        if (!current()) return
        const local = callbacksRef.current.getMarkdown?.()
          ?? callbacksRef.current.localMarkdown
          ?? editor.getMarkdown()
        setPreview({
          content: new TextDecoder().decode(remote.content), version: remote.version,
          localContent: local, platform, workspacePath, metadataKey, absolutePath,
        })
      } catch (error) {
        if (current()) toast({ title: t('failed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
      } finally {
        if (current()) setIsLoading(false)
      }
    }
    void fetchContents()
    return () => { cancelled = true }
  }, [open, activeFilePath, editor, isCurrent, t])

  const handleKeepLocal = async () => {
    if (!activeFilePath || !preview || operationRef.current || !isCurrent()) return
    if (prepareExternalAction && !prepareExternalAction()) return
    operationRef.current = true
    setIsLoading(true)
    const assertCurrent = () => {
      if (!isCurrent() || useSettingStore.getState().workspacePath !== preview.workspacePath) {
        throw syncStaleError({ stage: 'apply', path: activeFilePath, check: 'configuration' })
      }
      if (readMarkdown() !== preview.localContent) {
        throw syncStaleError({ stage: 'apply', path: activeFilePath, source: 'local', check: 'content' })
      }
    }
    try {
      assertCurrent()
      if (!await prepareActiveEditorDeactivationDurably(activeFilePath)) return
      assertCurrent()
      await useArticleStore.getState().flushPendingArticleSave(activeFilePath)
      assertCurrent()
      const content = readMarkdown()
      if (await readTextFile(preview.absolutePath) !== content) {
        throw syncStaleError({ stage: 'apply', path: activeFilePath, source: 'local', check: 'content' })
      }
      assertCurrent()
      const localWriteGuard = await captureWorkspaceRemoteWriteGuard(activeFilePath, preview.platform, true, content)
      const beforeWrite = async () => {
        assertCurrent()
        await localWriteGuard?.()
        assertCurrent()
      }
      await beforeWrite()
      for (const path of collectLocalMarkdownImagePaths(content, activeFilePath)) enqueueStaticAssetSync(path)
      await flushPendingStaticAssetSync({ force: true })
      assertCurrent()
      const needsCommit = ['github', 'gitee', 'gitlab', 'gitea'].includes(preview.platform)
      const message = needsCommit ? await generateGitSyncCommitMessage(activeFilePath, content) : ''
      assertCurrent()
      emitter.emit('sync-push-started', { path: activeFilePath })
      // The user's choice authorizes this preview's remote version only. A
      // newer remote version must fail the existing conditional-write guard.
      const uploadedVersion = await uploadGuardedWorkspaceFile(
        activeFilePath, content, preview.platform, preview.version, message, preview.metadataKey, beforeWrite,
      )
      assertCurrent()
      await setLocalRecordedSha(activeFilePath, uploadedVersion, preview.metadataKey)
      assertCurrent()
      await updateFileSyncTime(activeFilePath, preview.metadataKey)
      assertCurrent()
      if (preview.platform === 's3') useSyncStore.getState().updateS3FileEtag(activeFilePath, uploadedVersion)
      if (preview.platform === 'webdav') useSyncStore.getState().updateWebDAVFileEtag(activeFilePath, uploadedVersion)
      emitter.emit('sync-push-completed', { path: activeFilePath, success: true, sha: uploadedVersion })
      onResolved()
      onOpenChange(false)
    } catch (error) {
      if (isCurrent()) {
        emitter.emit('sync-push-completed', { path: activeFilePath, success: false })
        toast({ title: t('failed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
      }
    } finally {
      operationRef.current = false
      if (mountedRef.current) setIsLoading(false)
    }
  }

  const handleKeepRemote = async () => {
    if (!activeFilePath || !preview || operationRef.current || !isCurrent()) return
    if (prepareExternalAction && !prepareExternalAction()) return
    operationRef.current = true
    setIsLoading(true)
    try {
      const didSave = await callbacksRef.current.onKeepRemote(
        { content: preview.content, version: preview.version }, preview.localContent,
      )
      if (!didSave || !isCurrent()) return
      onResolved()
      onOpenChange(false)
    } catch (error) {
      if (isCurrent()) toast({ title: t('failed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    } finally {
      operationRef.current = false
      if (mountedRef.current) setIsLoading(false)
    }
  }

  const localContent = preview?.localContent ?? ''
  const remoteContent = preview?.content ?? ''
  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!operationRef.current) onOpenChange(nextOpen) }}>
      <DialogContent
        showCloseButton={false}
        className="flex min-h-0 min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl [&>[data-slot=drawer-scroll-area]]:overflow-hidden"
        style={{ height: 'min(46rem, calc(var(--mobile-viewport-height, 100dvh) - env(safe-area-inset-top) - 1rem))', maxHeight: 'calc(var(--mobile-viewport-height, 100dvh) - env(safe-area-inset-top) - 1rem)' }}
      >
        <DialogHeader className="max-h-[40%] shrink-0 gap-2 overflow-y-auto overscroll-contain p-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>{c('title')}</DialogTitle>
            <Button type="button" variant="ghost" size="icon-sm" disabled={operationRef.current} aria-label={c('close')} onClick={() => onOpenChange(false)}><X /></Button>
          </div>
          <DialogDescription>{c('versionDescription')}</DialogDescription>
          <p className="line-clamp-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]" title={activeFilePath ?? undefined}>{activeFilePath}</p>
        </DialogHeader>
        <div data-vaul-no-drag className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {isLoading && !preview ? <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status"><Spinner />{c('loading')}</div> : null}
          {preview ? <SyncContentComparison key={activeFilePath} localContent={localContent} remoteContent={remoteContent} localLabel={c('local')} remoteLabel={c('remote')} /> : null}
        </div>
        <DialogFooter className="m-0 grid max-h-[40%] shrink-0 grid-cols-2 gap-2 overflow-y-auto overscroll-contain border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex sm:flex-row sm:flex-wrap [&>button]:h-auto [&>button]:min-h-9 [&>button]:min-w-0 [&>button]:whitespace-normal [&>button]:[overflow-wrap:anywhere]">
          <Button
            variant="outline"
            onClick={handleKeepLocal}
            disabled={isLoading || !preview}
          >
            {c('keepLocal')}
          </Button>
          <Button
            onClick={handleKeepRemote}
            disabled={isLoading || !preview}
          >
            {c('keepRemote')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
