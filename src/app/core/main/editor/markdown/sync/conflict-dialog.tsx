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

// 简单的 diff 计算
function computeDiff(oldText: string, newText: string): { type: 'equal' | 'add' | 'remove', text: string }[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: { type: 'equal' | 'add' | 'remove', text: string }[] = []

  // 简单的行对比
  const maxLen = Math.max(oldLines.length, newLines.length)
  let oldIdx = 0
  let newIdx = 0

  while (oldIdx < maxLen || newIdx < maxLen) {
    const oldLine = oldLines[oldIdx]
    const newLine = newLines[newIdx]

    if (oldLine === newLine) {
      if (oldLine !== undefined) {
        result.push({ type: 'equal', text: oldLine })
      }
      oldIdx++
      newIdx++
    } else if (oldLine === undefined) {
      // 新增行
      if (newLine !== undefined) {
        result.push({ type: 'add', text: newLine })
      }
      newIdx++
    } else if (newLine === undefined) {
      // 删除行
      result.push({ type: 'remove', text: oldLine })
      oldIdx++
    } else {
      // 不相同，认为是修改
      result.push({ type: 'remove', text: oldLine })
      result.push({ type: 'add', text: newLine })
      oldIdx++
      newIdx++
    }
  }

  return result
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
  const diff = preview ? computeDiff(localContent, remoteContent) : []

  // 统计变化
  const addCount = diff.filter(d => d.type === 'add').length
  const removeCount = diff.filter(d => d.type === 'remove').length

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!operationRef.current) onOpenChange(nextOpen) }}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>文件冲突</DialogTitle>
          <DialogDescription>
            检测到远程文件与本地文件存在冲突。请选择要保留的版本。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex gap-4 min-h-[300px]">
          {/* 本地版本 */}
          <div className="flex-1 flex flex-col overflow-hidden border rounded-md">
            <div className="bg-muted px-3 py-2 text-sm font-medium border-b">
              本地版本
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
              {preview ? localContent : '加载中...'}
            </div>
          </div>

          {/* 远程版本 */}
          <div className="flex-1 flex flex-col overflow-hidden border rounded-md">
            <div className="bg-muted px-3 py-2 text-sm font-medium border-b">
              远程版本
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
              {preview ? remoteContent : '加载中...'}
            </div>
          </div>
        </div>

        {/* 变化统计 */}
        <div className="text-sm text-muted-foreground">
          <span className="text-green-500">+{addCount} 新增</span>
          {' / '}
          <span className="text-red-500">-{removeCount} 删除</span>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleKeepLocal}
            disabled={isLoading || !preview}
          >
            保留本地
          </Button>
          <Button
            onClick={handleKeepRemote}
            disabled={isLoading || !preview}
          >
            保留远程
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
