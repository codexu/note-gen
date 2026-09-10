import { getCurrentWindow } from '@tauri-apps/api/window'
import emitter from '@/lib/emitter'
import {
  PluginError,
  type ActiveEditorContext,
  type EditorActiveChangeEvent,
  type EditorContentChangeEvent,
  type EditorSelection,
  type EditorTextSnapshot,
  type ApplyEditorEditOptions,
  type ApplyEditorEditResult,
  type ApplyEditorEditsOptions,
  type SetEditorSelectionOptions,
  type EditorRangeEdit,
  type PluginDisposable,
} from '@notegen/plugin-api'

interface RegisteredEditor {
  registrationId: string
  editorId: string
  documentId: string
  path: string
  getMode: () => ActiveEditorContext['mode']
  getRevision: () => number
  isComposing: () => boolean
  getCanonicalMarkdown: () => string
  getSelection: () => {
    text: string
    from?: number
    to?: number
    empty?: boolean
  }
  applyMarkdownEdits?: (edits: readonly EditorRangeEdit[]) => void
  setMarkdownSelection?: (from: number, to: number) => void
}

export interface PluginEditorRegistration {
  path: string
  getMode: RegisteredEditor['getMode']
  getRevision: RegisteredEditor['getRevision']
  isComposing: RegisteredEditor['isComposing']
  getCanonicalMarkdown: RegisteredEditor['getCanonicalMarkdown']
  getSelection: RegisteredEditor['getSelection']
  applyMarkdownEdits?: RegisteredEditor['applyMarkdownEdits']
  setMarkdownSelection?: RegisteredEditor['setMarkdownSelection']
}

const activeListeners = new Set<(event: EditorActiveChangeEvent) => void | Promise<void>>()
const contentListeners = new Set<(event: EditorContentChangeEvent) => void | Promise<void>>()
const documentIds = new Map<string, string>()
let activeEditor: RegisteredEditor | null = null
let lastContext: ActiveEditorContext | null = null
let lastObservedRevision = -1
let lastObservedComposing: boolean | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollRunning = false

function createOpaqueId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
}

function getWindowId(): string {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
}

function getDocumentId(path: string): string {
  const normalized = path.normalize('NFC').replace(/\\/g, '/')
  const existing = documentIds.get(normalized)
  if (existing) return existing
  const created = createOpaqueId('document')
  documentIds.set(normalized, created)
  return created
}

function getSize(text: string): ActiveEditorContext['size'] {
  return {
    utf16Length: text.length,
    bytes: new TextEncoder().encode(text).byteLength,
    lines: text.length === 0 ? 1 : text.split('\n').length,
  }
}

function contextFor(
  editor: RegisteredEditor,
  markdown: string,
  composing = editor.isComposing(),
  revision = editor.getRevision(),
): ActiveEditorContext {
  const path = editor.path.normalize('NFC').replace(/\\/g, '/')
  const relativeMarkdown = /\.md$/i.test(path) && !/[:\u0000-\u001f]/.test(path)
    && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
  return {
    ...(relativeMarkdown ? { path } : {}),
    windowId: getWindowId(),
    editorId: editor.editorId,
    documentId: editor.documentId,
    kind: 'markdown',
    mode: editor.getMode(),
    revision,
    composing,
    size: getSize(markdown),
  }
}

async function emitActiveChange(
  previous: ActiveEditorContext | null,
  current: ActiveEditorContext | null,
): Promise<void> {
  const event = { previous, current }
  await Promise.allSettled(
    [...activeListeners].map((listener) => Promise.resolve().then(() => listener(event))),
  )
}

async function pollEditor(): Promise<void> {
  if (pollRunning || !activeEditor) return
  const editor = activeEditor
  pollRunning = true
  try {
    const before = editor.getRevision()
    const beforeComposing = editor.isComposing()
    if (
      before === lastObservedRevision
      && beforeComposing === lastObservedComposing
    ) return
    const markdown = editor.getCanonicalMarkdown()
    const after = editor.getRevision()
    const afterComposing = editor.isComposing()
    if (activeEditor !== editor || before !== after) return

    lastObservedRevision = after
    lastObservedComposing = afterComposing
    const context = contextFor(editor, markdown, afterComposing, after)
    lastContext = context
    const event: EditorContentChangeEvent = {
      editorId: context.editorId,
      documentId: context.documentId,
      revision: context.revision,
      composing: context.composing,
      size: context.size,
    }
    await Promise.allSettled(
      [...contentListeners].map((listener) => Promise.resolve().then(() => listener(event))),
    )
  } catch {
    // The editor may be disposed between an interval tick and its getters.
    // A later tick or the registration cleanup will restore the bridge state.
  } finally {
    pollRunning = false
  }
}

function syncPolling(): void {
  const needsPolling = Boolean(activeEditor && contentListeners.size > 0)
  if (!needsPolling && pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
    return
  }
  if (needsPolling && !pollTimer) {
    pollTimer = setInterval(() => void pollEditor(), 250)
    void pollEditor()
  }
}

export function registerPluginEditor(registration: PluginEditorRegistration): PluginDisposable {
  const registered: RegisteredEditor = {
    ...registration,
    registrationId: createOpaqueId('registration'),
    editorId: createOpaqueId('editor'),
    documentId: getDocumentId(registration.path),
  }
  const previousContext = lastContext
  activeEditor = registered
  lastObservedRevision = -1
  lastObservedComposing = null

  try {
    const markdown = registered.getCanonicalMarkdown()
    lastContext = contextFor(registered, markdown)
  } catch {
    lastContext = null
  }
  void emitActiveChange(previousContext, lastContext)
  syncPolling()

  return {
    dispose: () => {
      if (activeEditor?.registrationId !== registered.registrationId) return
      const previous = lastContext
      activeEditor = null
      lastContext = null
      lastObservedRevision = -1
      lastObservedComposing = null
      syncPolling()
      void emitActiveChange(previous, null)
    },
  }
}

export async function getActivePluginEditor(): Promise<ActiveEditorContext | null> {
  const editor = activeEditor
  if (!editor) return null
  const before = editor.getRevision()
  const markdown = editor.getCanonicalMarkdown()
  const after = editor.getRevision()
  if (activeEditor !== editor || before !== after) {
    throw new PluginError('StaleRevision', 'The active editor changed while it was being read')
  }
  const context = contextFor(editor, markdown)
  lastContext = context
  return context
}

export async function getPluginEditorSelection(): Promise<EditorSelection | null> {
  const editor = activeEditor
  if (!editor) return null
  const revision = editor.getRevision()
  const selection = editor.getSelection()
  if (activeEditor !== editor || revision !== editor.getRevision()) {
    throw new PluginError('StaleRevision', 'The selection changed while it was being read')
  }
  const offsetsAvailable = Number.isSafeInteger(selection.from)
    && Number.isSafeInteger(selection.to)
    && (selection.from ?? -1) >= 0
    && (selection.to ?? -1) >= (selection.from ?? 0)
  return {
    editorId: editor.editorId,
    revision,
    ...(offsetsAvailable ? { from: selection.from, to: selection.to } : {}),
    offsetsAvailable,
    empty: selection.empty ?? (
      offsetsAvailable
        ? selection.from === selection.to || selection.text.length === 0
        : selection.text.length === 0
    ),
    text: selection.text,
  }
}

export async function getPluginEditorTextSnapshot(options: {
  editorId: string
  expectedRevision: number
  format: 'markdown'
}): Promise<EditorTextSnapshot> {
  const editor = activeEditor
  if (!editor || editor.editorId !== options.editorId) {
    throw new PluginError('NotFound', 'The requested editor is no longer active')
  }
  const before = editor.getRevision()
  if (before !== options.expectedRevision) {
    throw new PluginError('StaleRevision', 'The editor revision has changed')
  }
  const text = editor.getCanonicalMarkdown()
  const after = editor.getRevision()
  if (activeEditor !== editor || before !== after) {
    throw new PluginError('StaleRevision', 'The editor changed while the snapshot was created')
  }
  return {
    editorId: editor.editorId,
    documentId: editor.documentId,
    revision: after,
    format: 'markdown',
    text,
  }
}

export async function applyPluginEditorEdit(
  options: ApplyEditorEditOptions,
): Promise<ApplyEditorEditResult> {
  const editor = activeEditor
  if (!editor || editor.editorId !== options.editorId) {
    throw new PluginError('NotFound', 'The requested editor is no longer active')
  }
  if (editor.getRevision() !== options.expectedRevision) {
    throw new PluginError('StaleRevision', 'The editor revision has changed')
  }
  if (editor.isComposing()) {
    throw new PluginError('EditorBusy', 'The editor is handling text composition')
  }
  if (new TextEncoder().encode(options.text).byteLength > 1_048_576) {
    throw new PluginError('QuotaExceeded', 'Editor edits are limited to 1 MiB')
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new PluginError('Timeout', 'The editor did not apply the plugin edit in time'))
    }, 5_000)
    emitter.emit('editor-insert', {
      filePath: editor.path,
      content: options.text,
      replaceSelection: options.target === 'selection',
      expectedVersion: options.expectedRevision,
      resolve: (result) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (!result.success) {
          reject(result.versionMismatch
            ? new PluginError('StaleRevision', 'The editor revision changed before the edit')
            : new PluginError('EditorBusy', 'The active editor rejected the plugin edit'))
          return
        }
        resolve({ applied: true, insertedLength: result.insertedLength })
      },
    })
  })
}

function editableSource(options: { editorId: string; expectedRevision: number }): RegisteredEditor {
  const editor = activeEditor
  if (!editor || editor.editorId !== options.editorId) throw new PluginError('NotFound', 'The editor is no longer active')
  if (!Number.isSafeInteger(options.expectedRevision) || editor.getRevision() !== options.expectedRevision) throw new PluginError('StaleRevision', 'The editor revision changed')
  if (editor.getMode() !== 'source') throw new PluginError('EditorBusy', 'Switch to source mode to use Markdown ranges')
  if (editor.isComposing()) throw new PluginError('EditorBusy', 'The editor is composing text')
  return editor
}

function assertMarkdownRange(text: string, from: number, to: number): void {
  const splitsSurrogate = (offset: number) => offset > 0 && offset < text.length
    && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > text.length
    || splitsSurrogate(from) || splitsSurrogate(to)) throw new PluginError('InvalidPath', 'Invalid Markdown UTF-16 range')
}

export async function applyPluginEditorEdits(options: ApplyEditorEditsOptions): Promise<ApplyEditorEditResult> {
  const editor = editableSource(options)
  if (!editor.applyMarkdownEdits) throw new PluginError('EditorBusy', 'The source editor is not ready')
  if (!Array.isArray(options.edits) || options.edits.length === 0 || options.edits.length > 100) throw new PluginError('QuotaExceeded', 'Supply between 1 and 100 edits')
  const text = editor.getCanonicalMarkdown()
  const edits = options.edits.map(edit => ({ ...edit })).sort((a, b) => a.from - b.from || a.to - b.to)
  let insertedLength = 0
  let bytes = 0
  for (const [index, edit] of edits.entries()) {
    if (typeof edit.text !== 'string') throw new PluginError('InvalidPath', 'Edit text must be a string')
    assertMarkdownRange(text, edit.from, edit.to)
    const previous = edits[index - 1]
    if (previous && (edit.from < previous.to || edit.from === previous.from)) throw new PluginError('Conflict', 'Edit ranges overlap or share an insertion point')
    insertedLength += edit.text.length
    bytes += new TextEncoder().encode(edit.text).byteLength
  }
  if (bytes > 1_048_576) throw new PluginError('QuotaExceeded', 'Editor edits are limited to 1 MiB')
  if (editableSource(options) !== editor) throw new PluginError('StaleRevision', 'The editor changed')
  editor.applyMarkdownEdits(edits)
  return { applied: true, insertedLength }
}

export async function setPluginEditorSelection(options: SetEditorSelectionOptions): Promise<void> {
  const editor = editableSource(options)
  if (!editor.setMarkdownSelection) throw new PluginError('EditorBusy', 'The source editor is not ready')
  assertMarkdownRange(editor.getCanonicalMarkdown(), options.from, options.to)
  if (editableSource(options) !== editor) throw new PluginError('StaleRevision', 'The editor changed')
  editor.setMarkdownSelection(options.from, options.to)
}

export function onDidChangeActivePluginEditor(
  listener: (event: EditorActiveChangeEvent) => void | Promise<void>,
): PluginDisposable {
  activeListeners.add(listener)
  return { dispose: () => activeListeners.delete(listener) }
}

export function onDidChangePluginEditorContent(
  listener: (event: EditorContentChangeEvent) => void | Promise<void>,
): PluginDisposable {
  contentListeners.add(listener)
  syncPolling()
  return {
    dispose: () => {
      contentListeners.delete(listener)
      syncPolling()
    },
  }
}

export function hasActiveMarkdownPluginEditor(): boolean {
  return activeEditor !== null
}
