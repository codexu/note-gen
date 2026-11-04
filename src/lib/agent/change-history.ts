import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getChatById, updateChatAgentHistory } from '@/db/chats'
import useArticleStore from '@/stores/article'
import useChatStore from '@/stores/chat'
import useSettingStore from '@/stores/setting'
import { readingKey, useEditorReadingStore } from '@/stores/editor-reading'
import emitter from '@/lib/emitter'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import {
  editorPathsReferToSameFile,
  getCurrentEditorWorkspaceRoot,
  lockEditorPathsForMutation,
  markEditorPathMutation,
  runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'
import { getSkillWorkspaceIdentity } from '@/lib/skills/runtime'
import { deleteMarkdownFileTool, updateMarkdownFileTool } from './tools/note-tools'
import type { AgentChange } from './types'

export interface RevertAgentChangeResult {
  ok: boolean
  reason?: 'changed' | 'workspace' | 'unavailable' | 'failed' | 'busy'
  revertedAt?: number
  historySaved?: boolean
  contentSaved?: boolean
  refreshComplete?: boolean
}

let restoring = false

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function readHistory(value?: string): Record<string, unknown> | undefined {
  try { return value ? object(JSON.parse(value)) : undefined } catch { return undefined }
}

/** Restore a recorded snapshot only while the file still matches its recorded result. */
export async function revertAgentChange(requested: AgentChange, chatId: number): Promise<RevertAgentChangeResult> {
  if (restoring || useChatStore.getState().loading) return { ok: false, reason: 'busy' }
  restoring = true
  let unlock: (() => void) | undefined
  let contentRestored = false
  let contentSaved = true
  let refreshComplete = true
  try {
    const chat = chatId >= 0 ? await getChatById(chatId)
      : useChatStore.getState().chats.find(item => item.id === chatId)
    const history = readHistory(chat?.agentHistory)
    const changes = Array.isArray(history?.changes) ? history.changes : []
    const recorded = object(changes.find(item => object(item)?.id === requested.id))
    if (!chat || !history || !recorded || !recorded.reversible
      || (recorded.outcome === 'unverified' && (typeof recorded.before !== 'string' || typeof recorded.after !== 'string'))
      || !['file', 'editor'].includes(String(recorded.type))
      || typeof recorded.target !== 'string'
      || typeof recorded.workspacePath !== 'string'
      || (typeof recorded.before !== 'string' && typeof recorded.after !== 'string')) {
      return { ok: false, reason: 'unavailable' }
    }
    if (typeof recorded.revertedAt === 'number') return { ok: true, revertedAt: recorded.revertedAt }
    const change = recorded as unknown as AgentChange
    const workspace = await getWorkspacePath()
    if (getSkillWorkspaceIdentity(workspace) !== change.workspacePath) return { ok: false, reason: 'workspace' }
    const path = await ensureSafeWorkspaceRelativePath(change.target)
    if (useEditorReadingStore.getState().readOnlyFiles[readingKey(useSettingStore.getState().workspacePath, path)]) {
      return { ok: false, reason: 'unavailable' }
    }
    const root = await getCurrentEditorWorkspaceRoot()
    const release = lockEditorPathsForMutation([path], root)
    if (!release) return { ok: false, reason: 'busy' }
    unlock = release
    const currentWorkspace = async () => getSkillWorkspaceIdentity(await getWorkspacePath()) === change.workspacePath
    if (!await currentWorkspace()) return { ok: false, reason: 'workspace' }
    const pinnedFile = await getFilePathOptions(path)
    if (!await currentWorkspace()) return { ok: false, reason: 'workspace' }
    const matchesRestoredSnapshot = async (data: unknown) => {
      const applied = object(object(data)?.appliedChange)
      if (applied?.filePath !== path || applied.before !== change.after || applied.after !== change.before) return false
      // A tool may report a completed write followed by a failed refresh. Read
      // its pinned file before treating that partial result as a completed undo.
      const options = pinnedFile.baseDir === undefined ? {} : { baseDir: pinnedFile.baseDir }
      const present = await exists(pinnedFile.path, options)
      return change.before === undefined ? !present
        : present && await readTextFile(pinnedFile.path, options) === change.before
    }

    if (change.before === undefined) {
      // Undo creation. The delete tool flushes the live editor before comparing.
      const result = await deleteMarkdownFileTool.execute({ filePath: path, expectedContent: change.after, workspaceIdentity: change.workspacePath })
      if (!result.success && !await matchesRestoredSnapshot(result.data)) {
        return { ok: false, reason: result.error === 'FILE_CONTENT_CHANGED' ? 'changed' : 'failed' }
      }
      contentRestored = true
      refreshComplete = result.success
    } else if (change.after === undefined) {
      // Undo deletion without replacing a new file at the same path.
      const options = pinnedFile
      if (!await currentWorkspace()) return { ok: false, reason: 'workspace' }
      const fsOptions = options.baseDir === undefined ? {} : { baseDir: options.baseDir }
      if (await exists(options.path, fsOptions)) return { ok: false, reason: 'changed' }
      const parentSeparator = Math.max(options.path.lastIndexOf('/'), options.path.lastIndexOf('\\'))
      const parent = options.path.slice(0, parentSeparator + 1)
      if (parent) await mkdir(parent, { recursive: true, ...fsOptions })
      const before = change.before
      const restored = await runEditorPathWriteTransaction(path, async ({ hasQueuedSave }) => {
        if (hasQueuedSave() || !await currentWorkspace() || await exists(options.path, fsOptions)) return false
        await writeTextFile(options.path, before, { ...fsOptions, createNew: true })
        markEditorPathMutation(path, root)
        return true
      }, root)
      if (!restored) return { ok: false, reason: 'changed' }
      contentRestored = true
      try {
        if (await currentWorkspace()) {
          useArticleStore.getState().insertLocalEntry(path, false)
          emitter.emit('editor-file-content-updated', { path, content: before })
          emitter.emit('article-saved', { path, content: before, pluginChangeType: 'created' })
        }
      } catch { refreshComplete = false }
    } else {
      const active = editorPathsReferToSameFile(useArticleStore.getState().activeFilePath, path, root)
      const hasEditor = Boolean(emitter.all.get('editor-agent-restore')?.length)
      if (active && hasEditor) {
        // The editor handler is synchronous: no timeout can leave a delayed edit.
        let result: RevertAgentChangeResult = { ok: false, reason: 'unavailable' }
        emitter.emit('editor-agent-restore', {
          filePath: path,
          expectedContent: change.after,
          content: change.before,
          resolve: value => { result = value },
        })
        if (!result.ok) return result
        contentRestored = true
        try { await useArticleStore.getState().flushPendingArticleSave(path) }
        catch { contentSaved = false }
      } else {
        // Hidden/mobile editors are flushed and updated by the existing file bridge.
        const result = await updateMarkdownFileTool.execute({
          filePath: path, content: change.before, expectedContent: change.after, workspaceIdentity: change.workspacePath,
        })
        if (!result.success && !await matchesRestoredSnapshot(result.data)) {
          return { ok: false, reason: result.error === 'FILE_CONTENT_CHANGED' ? 'changed' : 'failed' }
        }
        contentRestored = true
        refreshComplete = result.success
      }
    }

    contentRestored = true

    const revertedAt = Date.now()
    // Keep an unsaved editor restore local to the visible card. Persisting the
    // marker would prevent retrying after a restart with the old file on disk.
    if (!contentSaved) return { ok: true, revertedAt, historySaved: false, contentSaved, refreshComplete }
    const mark = (value: unknown): unknown => {
      const item = object(value)
      return item?.id === change.id ? { ...item, revertedAt } : value
    }
    const markHistory = (value: Record<string, unknown>) => JSON.stringify({
      ...value,
      changes: (Array.isArray(value.changes) ? value.changes : changes).map(mark),
      traceEvents: Array.isArray(value.traceEvents) ? value.traceEvents.map(item => {
        const event = object(item)
        return event?.type === 'change' ? { ...event, output: mark(event.output) } : item
      }) : value.traceEvents,
    })
    // Reflect the completed restore immediately, even if the database is unavailable.
    const visibleChat = useChatStore.getState().chats.find(item => item.id === chatId)
    if (visibleChat) useChatStore.getState().updateChat({
      ...visibleChat, agentHistory: markHistory(readHistory(visibleChat.agentHistory) ?? history),
    })
    try {
      for (let attempt = 0; chatId >= 0 && attempt < 3; attempt++) {
        const latestChat = await getChatById(chatId)
        if (!latestChat) break
        const nextHistory = markHistory(readHistory(latestChat.agentHistory) ?? history)
        if (!await updateChatAgentHistory(chatId, latestChat.agentHistory, nextHistory)) continue
        const currentChat = useChatStore.getState().chats.find(item => item.id === chatId)
        if (currentChat) useChatStore.getState().updateChat({ ...currentChat, agentHistory: nextHistory })
        return { ok: true, revertedAt, historySaved: true, contentSaved, refreshComplete }
      }
    } catch {
      return { ok: true, revertedAt, historySaved: false, contentSaved, refreshComplete }
    }
    return { ok: true, revertedAt, historySaved: chatId < 0, contentSaved, refreshComplete }
  } catch {
    if (contentRestored) return { ok: true, revertedAt: Date.now(), historySaved: false, contentSaved, refreshComplete }
    return { ok: false, reason: 'failed' }
  } finally {
    unlock?.()
    restoring = false
  }
}
