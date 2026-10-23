'use client'

import { Editor } from '@tiptap/react'
import { ArrowDownCircle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { compareFileVersions, setLocalRecordedSha } from '@/lib/sync/auto-sync'
import { updateFileSyncTime } from '@/lib/sync/conflict-resolution'
import emitter from '@/lib/emitter'
import { toast } from '@/hooks/use-toast'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { getFilePathOptions } from '@/lib/workspace'
import { getCurrentEditorWorkspaceRoot, markEditorPathMutation, prepareActiveEditorDeactivationDurably, runEditorPathWriteTransaction } from '@/lib/editor-deactivation'
import { captureWorkspaceRemoteWriteGuard } from '@/lib/sync/workspace-remote-write-guard'
import { getSyncMetadataKey } from '@/lib/sync/sync-context'
import { readVersionedWorkspaceFile } from '@/lib/sync/guarded-workspace-upload'
import { isSyncStaleError, syncStaleError } from '@/lib/sync/sync-stale-error'
import { ConflictDialog } from './conflict-dialog'
import { useDocumentSyncConfiguration } from './sync-button'

interface PullButtonProps {
  editor: Editor
  markdown?: string
  getMarkdown?: () => string
  prepareExternalAction?: () => boolean
  onMarkdownChange?: (markdown: string) => void
}

export type PullStatus = 'idle' | 'checking' | 'update-available' | 'pulling' | 'conflict' | 'error'

const IDLE_PULL_INTERVAL = 30 * 1000
const IDLE_THRESHOLD = 10 * 1000

export function usePullSync({ editor, markdown, getMarkdown, prepareExternalAction, onMarkdownChange }: PullButtonProps) {
  const activeFilePath = useArticleStore(state => state.activeFilePath)
  const autoPullOnOpen = useSettingStore(state => state.autoPullOnOpen)
  const { configured, contextKey, isContextCurrent } = useDocumentSyncConfiguration()
  const activeContext = `${contextKey}:${activeFilePath ?? ''}`
  const activeContextRef = useRef(activeContext)
  activeContextRef.current = activeContext
  const mountedRef = useRef(false)
  const callbacksRef = useRef({ markdown, getMarkdown, prepareExternalAction, onMarkdownChange })
  callbacksRef.current = { markdown, getMarkdown, prepareExternalAction, onMarkdownChange }
  const [state, setState] = useState<{ context: string; status: PullStatus; hasUpdate: boolean }>({
    context: '', status: 'idle', hasUpdate: false,
  })
  const [conflictContext, setConflictContext] = useState<string | null>(null)
  const operationRef = useRef<{ context: string } | null>(null)
  const checkedSnapshotRef = useRef<{ context: string; markdown: string } | null>(null)
  const lastInputTimeRef = useRef(0)

  const isCurrent = useCallback(() => mountedRef.current
    && isContextCurrent()
    && activeContextRef.current === activeContext
    && useArticleStore.getState().activeFilePath === activeFilePath,
  [activeContext, activeFilePath, isContextCurrent])

  const setStatus = useCallback((status: PullStatus, hasUpdate = false) => {
    if (isCurrent()) setState({ context: activeContext, status, hasUpdate })
  }, [activeContext, isCurrent])

  const readMarkdown = useCallback(() => callbacksRef.current.getMarkdown?.()
    ?? callbacksRef.current.markdown
    ?? editor.getMarkdown(), [editor])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    checkedSnapshotRef.current = null
    setConflictContext(null)
    lastInputTimeRef.current = 0
  }, [activeContext])

  const check = useCallback(async () => {
    if (!activeFilePath || !configured || !isCurrent()
      || operationRef.current?.context === activeContext) return
    const operation = { context: activeContext }
    operationRef.current = operation
    const localSnapshot = readMarkdown()
    setStatus('checking')
    try {
      const result = await compareFileVersions(activeFilePath)
      if (!isCurrent() || operationRef.current !== operation) return
      if (result.action === 'conflict') {
        setStatus('conflict')
      } else if (result.action === 'pull') {
        const previousSnapshot = checkedSnapshotRef.current
        const snapshot = previousSnapshot?.context === activeContext ? previousSnapshot.markdown : localSnapshot
        checkedSnapshotRef.current = { context: activeContext, markdown: snapshot }
        setStatus(readMarkdown() === snapshot ? 'update-available' : 'conflict', true)
      } else {
        checkedSnapshotRef.current = null
        setStatus('idle')
      }
    } catch {
      if (isCurrent()) setStatus('error')
    } finally {
      if (operationRef.current === operation) operationRef.current = null
    }
  }, [activeContext, activeFilePath, configured, isCurrent, readMarkdown, setStatus])

  const openConflict = useCallback(() => {
    if (!activeFilePath || !configured || !isCurrent()) return
    if (callbacksRef.current.prepareExternalAction && !callbacksRef.current.prepareExternalAction()) return
    setConflictContext(activeContext)
  }, [activeContext, activeFilePath, configured, isCurrent])

  const applyRemoteSnapshot = useCallback(async (
    remoteFile: { content: string; version: string },
    localSnapshot: string,
  ): Promise<boolean> => {
    if (!activeFilePath || !configured || !isCurrent()) return false
    const assertCurrent = () => {
      if (!isCurrent()) throw syncStaleError({ stage: 'apply', path: activeFilePath, check: 'configuration' })
      if (readMarkdown() !== localSnapshot) {
        throw syncStaleError({ stage: 'apply', path: activeFilePath, source: 'local', check: 'content' })
      }
    }
    assertCurrent()
    if (callbacksRef.current.prepareExternalAction && !callbacksRef.current.prepareExternalAction()) return false
    if (!await prepareActiveEditorDeactivationDurably(activeFilePath)) return false
    assertCurrent()
    await useArticleStore.getState().flushPendingArticleSave(activeFilePath)
    assertCurrent()
    const platform = useSettingStore.getState().primaryBackupMethod
    if (platform === 'local' || platform === 'selfHosted') return false
    const localWriteGuard = await captureWorkspaceRemoteWriteGuard(activeFilePath, platform)
    const metadataKey = await getSyncMetadataKey(activeFilePath, platform)
    const pathOptions = await getFilePathOptions(activeFilePath)
    const absolutePath = pathOptions.baseDir === undefined
      ? pathOptions.path : await join(await appDataDir(), pathOptions.path)
    const workspaceRoot = await getCurrentEditorWorkspaceRoot()
    assertCurrent()
    const diskSnapshot = await readTextFile(absolutePath)
    assertCurrent()
    if (diskSnapshot !== localSnapshot) {
      throw syncStaleError({ stage: 'apply', path: activeFilePath, source: 'local', check: 'content' })
    }
    const restoreDiskSnapshot = () => writeTextFile(absolutePath, diskSnapshot)
    markEditorPathMutation(activeFilePath)
    const didSave = await runEditorPathWriteTransaction(activeFilePath, async ({ hasQueuedSave }) => {
      assertCurrent()
      await localWriteGuard?.()
      assertCurrent()
      const currentDisk = await readTextFile(absolutePath)
      if (currentDisk !== diskSnapshot || hasQueuedSave()) return false
      assertCurrent()
      try {
        await writeTextFile(absolutePath, remoteFile.content)
      } catch (error) {
        await restoreDiskSnapshot()
        throw error
      }
      // A switch or new save during the disk write can only restore the old
      // workspace's captured absolute path; it cannot address a new workspace.
      if (!isCurrent() || readMarkdown() !== localSnapshot || hasQueuedSave()) {
        await restoreDiskSnapshot()
        return false
      }
      markEditorPathMutation(activeFilePath)
      const onChange = callbacksRef.current.onMarkdownChange
      if (onChange) onChange(remoteFile.content)
      else editor.commands.setContent(remoteFile.content, { contentType: 'markdown' })
      return true
    }, workspaceRoot)
    if (!didSave || !isCurrent()) return false
    checkedSnapshotRef.current = null
    await updateFileSyncTime(activeFilePath, metadataKey)
    if (!isCurrent()) return false
    await setLocalRecordedSha(activeFilePath, remoteFile.version, metadataKey)
    if (!isCurrent()) return false
    emitter.emit('sync-pulled', { path: activeFilePath })
    setStatus('idle')
    return true
  }, [activeFilePath, configured, editor, isCurrent, readMarkdown, setStatus])

  const pull = useCallback(async () => {
    if (!activeFilePath || !configured || !isCurrent()
      || operationRef.current?.context === activeContext) return
    if (callbacksRef.current.prepareExternalAction && !callbacksRef.current.prepareExternalAction()) return
    const operation = { context: activeContext }
    operationRef.current = operation
    const localSnapshot = readMarkdown()
    const checkedSnapshot = checkedSnapshotRef.current
    if (checkedSnapshot?.context === activeContext && checkedSnapshot.markdown !== localSnapshot) {
      operationRef.current = null
      setStatus('conflict', true)
      openConflict()
      return
    }
    setStatus('pulling')
    try {
      if (!await prepareActiveEditorDeactivationDurably(activeFilePath)) {
        setStatus('idle')
        return
      }
      if (!isCurrent()) return
      const platform = useSettingStore.getState().primaryBackupMethod
      if (platform === 'local' || platform === 'selfHosted') {
        setStatus('idle')
        return
      }
      const result = await compareFileVersions(activeFilePath)
      if (!isCurrent()) return
      if (result.action === 'conflict') {
        setStatus('conflict')
        openConflict()
        return
      }
      const remoteFile = await readVersionedWorkspaceFile(activeFilePath, platform)
      if (!isCurrent()) return
      const didSave = await applyRemoteSnapshot({
        content: new TextDecoder().decode(remoteFile.content), version: remoteFile.version,
      }, localSnapshot)
      if (!didSave) setStatus('conflict', true)
    } catch (error) {
      if (!isCurrent()) return
      if (isSyncStaleError(error)) {
        setStatus('conflict', true)
        return
      }
      console.error('Pull failed:', error)
      setStatus('error')
      toast({
        title: '拉取失败',
        description: error instanceof Error ? error.message : '请检查网络连接后重试',
        variant: 'destructive',
      })
    } finally {
      if (operationRef.current === operation) operationRef.current = null
    }
  }, [activeContext, activeFilePath, applyRemoteSnapshot, configured, isCurrent, openConflict, readMarkdown, setStatus])

  useEffect(() => {
    // syncOnOpen owns the initial automatic pull. The persistent monitor only
    // checks versions afterwards, and never applies changes in the background.
    if (!activeFilePath || !configured || autoPullOnOpen) return
    const timeout = setTimeout(() => { void check() }, 500)
    return () => clearTimeout(timeout)
  }, [activeFilePath, configured, autoPullOnOpen, check])

  useEffect(() => {
    const handleInput = () => { lastInputTimeRef.current = Date.now() }
    emitter.on('editor-input', handleInput)
    return () => { emitter.off('editor-input', handleInput) }
  }, [])

  useEffect(() => {
    if (!configured || !activeFilePath) return
    const interval = setInterval(() => {
      if (Date.now() - lastInputTimeRef.current >= IDLE_THRESHOLD) void check()
    }, IDLE_PULL_INTERVAL)
    return () => clearInterval(interval)
  }, [configured, activeFilePath, check])

  const conflictDialog = activeFilePath && configured && conflictContext === activeContext ? (
    <ConflictDialog
      key={activeContext}
      open
      onOpenChange={open => { if (!open) setConflictContext(null) }}
      activeFilePath={activeFilePath}
      editor={editor}
      localMarkdown={markdown}
      getMarkdown={getMarkdown}
      prepareExternalAction={() => isCurrent()
        && (!callbacksRef.current.prepareExternalAction || callbacksRef.current.prepareExternalAction())}
      isScopeCurrent={isCurrent}
      onKeepRemote={applyRemoteSnapshot}
      onResolved={() => {
        if (!isCurrent()) return
        checkedSnapshotRef.current = null
        setStatus('idle')
      }}
    />
  ) : null
  const status = state.context === activeContext ? state.status : 'idle'

  return {
    configured,
    path: activeFilePath,
    busy: status === 'checking' || status === 'pulling',
    status,
    hasUpdate: state.context === activeContext && state.hasUpdate,
    pull,
    check,
    openConflict,
    conflictDialog,
  }
}

export function PullButton(props: PullButtonProps) {
  const {
    configured: isConfigured,
    path: activeFilePath,
    status: pullStatus,
    hasUpdate,
    pull: handlePull,
    openConflict: handleConflict,
    conflictDialog,
  } = usePullSync(props)
  if (!isConfigured || !activeFilePath) return null

  return (
    <>
      <div className="flex items-center gap-1">
        {/* 拉取中状态 */}
        {pullStatus === 'pulling' ? (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            拉取中...
          </span>
        ) : pullStatus === 'conflict' ? (
          /* 冲突状态 - 提示用户处理 */
          <button
            onClick={handleConflict}
            className="p-0.5 rounded transition-colors hover:bg-red-500/10 text-red-500 flex items-center gap-1"
            title="处理冲突"
          >
            <ArrowDownCircle size={14} />
            <span className="text-xs">有冲突</span>
          </button>
        ) : hasUpdate ? (
          /* 有更新可以拉取 */
          <button
            onClick={handlePull}
            className="p-0.5 rounded transition-colors hover:bg-amber-500/10 text-amber-500 flex items-center gap-1"
            title="拉取更新"
          >
            <ArrowDownCircle size={14} />
            <span className="text-xs">有更新</span>
          </button>
        ) : pullStatus === 'checking' ? (
          /* 检查中状态 */
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            检查中
          </span>
        ) : (
          /* 无需拉取时也显示可点击的按钮，让用户可以手动拉取 */
          <button
            onClick={handlePull}
            className="p-0.5 rounded transition-colors hover:bg-accent text-muted-foreground flex items-center gap-1"
            title="手动拉取远程文件"
          >
            <ArrowDownCircle size={14} />
            <span className="text-xs">拉取</span>
          </button>
        )}
      </div>

      {conflictDialog}
    </>
  )
}

export default PullButton
