import { isPluginDisplayVisible } from './display-preferences'
import { create } from 'zustand'
import { z } from 'zod'
import {
  PluginError,
  parsePluginUiExtension,
  flattenPluginUiBlocks,
  type PluginUiBlock,
  type PluginDialogOptions,
  type PluginDialogUpdate,
  type PluginJsonValue,
  type PluginUiDocument,
  type PluginViewState,
  type PluginPromptOptions,
  type PluginPromptResult,
  type PluginDisposable,
  type PluginDialogCloseEvent,
  type PluginDialogHandle,
} from '@notegen/plugin-api'
import { usePluginStore } from '@/stores/plugins'
import { useSidebarStore } from '@/stores/sidebar'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useArticleStore from '@/stores/article'
import { getPluginManifestFingerprint } from './internal-types'
import { clearPluginForms, clearAllPluginForms, reconcilePluginForm, pluginFormKey, usePluginFormStore } from './form-state'

interface PluginDialogState extends PluginDialogOptions { pluginId: string; id: string }

const dialogListeners = new Map<string, Set<(event: PluginDialogCloseEvent) => void | Promise<void>>>()
let viewActivationResolver: ((pluginId: string) => Promise<void>) | null = null
let navigationSequence = 0
export function setPluginViewActivationResolver(resolver: typeof viewActivationResolver): void {
  viewActivationResolver = resolver
  // Mounted views must retry after startup or a host restart, even if their
  // plugin, workspace and content hash have not changed.
  usePluginUiStore.setState(state => ({ hostRevision: state.hostRevision + 1 }))
}
export async function activatePluginView(pluginId: string, viewId: string): Promise<void> {
  declaredView(pluginId, viewId)
  if (!viewActivationResolver) throw new PluginError('Cancelled', 'Plugin host is not running')
  await viewActivationResolver(pluginId)
}
export function cancelPluginViewNavigation(): void { navigationSequence += 1 }
export function onPluginDialogClose(pluginId: string, listener: (event: PluginDialogCloseEvent) => void | Promise<void>): PluginDisposable {
  const listeners = dialogListeners.get(pluginId) ?? new Set()
  listeners.add(listener)
  dialogListeners.set(pluginId, listeners)
  return { dispose: () => { listeners.delete(listener); if (!listeners.size) dialogListeners.delete(pluginId) } }
}
export function dismissPluginDialog(id: string, reason: PluginDialogCloseEvent['reason'] = 'user'): void {
  const dialog = usePluginUiStore.getState().dialog
  if (!dialog || dialog.id !== id) return
  usePluginUiStore.getState().setDialog(null)
  clearPluginForms(`${dialog.pluginId}:dialog:${id}`)
  for (const listener of dialogListeners.get(dialog.pluginId) ?? []) {
    void Promise.resolve().then(() => listener({ id, reason })).catch(() => undefined)
  }
}

interface PluginUiState {
  hostRevision: number
  embeddedContexts: Record<string, string>
  views: Record<string, PluginUiDocument>
  hiddenTitleBarViews: string[]
  setTitleBarVisible: (key: string, visible: boolean) => void
  activeRightView: string | null
  editorTabs: string[]
  activeEditorView: string | null
  focusRequest: { key: string; sequence: number } | null
  prompt: { id: string; pluginId: string; options: PluginPromptOptions } | null
  dialog: PluginDialogState | null
  setView: (key: string, content: PluginUiDocument) => void
  setActiveRightView: (key: string | null) => void
  setActiveEditorView: (key: string | null) => void
  closeEditorView: (key: string) => void
  requestFocus: (key: string) => void
  setDialog: (dialog: PluginDialogState | null) => void
  clearPlugin: (pluginId: string) => void
}

const jsonValueSchema: z.ZodType<PluginJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]))

const actionSchema = z.object({
  id: z.string().min(1).max(160),
  label: z.string().min(1).max(160),
  command: z.string().min(1).max(220),
  argument: jsonValueSchema.optional(),
  variant: z.enum(['default', 'secondary', 'destructive']).optional(),
  disabled: z.boolean().optional(),
}).strict()

const fieldBase = {
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  label: z.string().min(1).max(160),
  description: z.string().max(2_000).optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  visibleWhen: z.object({ field: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), equals: z.union([z.string().max(10_000), z.number().finite(), z.boolean()]) }).strict().optional(),
}
const textField = {
  ...fieldBase,
  value: z.string().max(10_000).optional(),
  placeholder: z.string().max(500).optional(),
  maxLength: z.number().int().min(1).max(10_000).optional(),
}
const fieldSchema = z.discriminatedUnion('type', [
  z.object({ ...textField, type: z.literal('text') }).strict(),
  z.object({ ...textField, type: z.literal('textarea') }).strict(),
  z.object({ ...textField, type: z.literal('search') }).strict(),
  z.object({ ...textField, type: z.literal('date') }).strict(),
  z.object({ ...fieldBase, type: z.literal('note-picker'), value: z.string().max(1024).optional(), options: z.array(z.object({ label: z.string().min(1).max(160), value: z.string().min(1).max(1024) }).strict()).max(100) }).strict(),
  z.object({ ...fieldBase, type: z.literal('checkbox'), value: z.boolean().optional() }).strict(),
  z.object({ ...fieldBase, type: z.literal('number'), value: z.number().finite().optional(), min: z.number().finite().optional(), max: z.number().finite().optional() }).strict(),
  z.object({ ...fieldBase, type: z.literal('select'), value: z.string().max(160).optional(), options: z.array(z.object({ label: z.string().min(1).max(160), value: z.string().min(1).max(160) }).strict()).min(1).max(100) }).strict(),
])

const legacyBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('navigation-list'),
    id: z.string().min(1).max(160), generation: z.string().min(1).max(160),
    label: z.string().min(1).max(160), emptyText: z.string().max(500),
    addLabel: z.string().min(1).max(160), removeLabel: z.string().min(1).max(160), reorderLabel: z.string().min(1).max(160),
    items: z.array(z.object({ id: z.string().min(1).max(1024), label: z.string().min(1).max(500) }).strict()).max(100),
    openCommand: z.string().min(1).max(220), addCommand: z.string().min(1).max(220),
    removeCommand: z.string().min(1).max(220), reorderCommand: z.string().min(1).max(220),
  }).strict(),
  z.object({ type: z.literal('separator') }).strict(),
  z.object({ type: z.literal('callout'), title: z.string().min(1).max(240), text: z.string().max(20_000), tone: z.enum(['default', 'destructive']).optional() }).strict(),
  z.object({ type: z.literal('progress'), label: z.string().min(1).max(160), value: z.number().finite().min(0).max(100) }).strict(),
  z.object({ type: z.literal('heading'), text: z.string().max(2_000) }).strict(),
  z.object({ type: z.literal('text'), text: z.string().max(20_000), tone: z.enum(['default', 'muted', 'warning']).optional() }).strict(),
  z.object({ type: z.literal('list'), items: z.array(z.string().max(2_000)).max(100) }).strict(),
  z.object({ type: z.literal('key-value'), items: z.array(z.object({ label: z.string().max(500), value: z.string().max(2_000) }).strict()).max(100) }).strict(),
  z.object({ type: z.literal('actions'), actions: z.array(actionSchema).max(20) }).strict(),
  z.object({ type: z.literal('form'), id: z.string().min(1).max(160), resetKey: z.string().max(160).optional(), changeCommand: z.string().min(1).max(220).optional(), submitDisabled: z.boolean().optional(), fields: z.array(fieldSchema).min(1).max(30), submitLabel: z.string().min(1).max(160), command: z.string().min(1).max(220) }).strict(),
  z.object({ type: z.literal('table'), id: z.string().min(1).max(160).optional(), rowIds: z.array(z.string().min(1).max(160)).max(100).optional(), columns: z.array(z.string().max(500)).min(1).max(20), rows: z.array(z.array(z.union([z.string().max(2_000), z.object({ text: z.string().min(1).max(160), command: z.string().min(1).max(220), argument: jsonValueSchema.optional(), disabled: z.boolean().optional() }).strict()])).max(20)).max(100) }).strict(),
  z.object({ type: z.literal('tree'), items: z.array(z.object({ id: z.string().min(1).max(160), parentId: z.string().min(1).max(160).optional(), label: z.string().max(500), command: z.string().min(1).max(220).optional(), argument: jsonValueSchema.optional() }).strict()).max(100) }).strict(),
])

function parseBlocks(value: unknown, depth = 0): PluginUiBlock[] {
  if (depth > 6 || !Array.isArray(value) || value.length > 50) throw new PluginError('InvalidPath', 'Invalid UI nesting or block count')
  return value.map(block => parsePluginUiExtension(block, children => parseBlocks(children, depth + 1)) ?? legacyBlockSchema.parse(block))
}
const blocksSchema = z.unknown().transform((value, context) => {
  try { const blocks = parseBlocks(value); flattenPluginUiBlocks(blocks); return blocks }
  catch { context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid UI blocks' }); return z.NEVER }
})

const documentSchema = z.object({ blocks: blocksSchema, expectedContextId: z.string().min(1).max(160).optional(), expectedForm: z.object({ formId: z.string().min(1).max(160), generation: z.string().min(1).max(160), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().optional() }).strict()
const dialogSchema = z.object({
  replaceId: z.string().min(1).max(160).optional(),
  title: z.string().min(1).max(240),
  description: z.string().max(2_000).optional(),
  content: documentSchema,
  closeLabel: z.string().min(1).max(160).optional(),
}).strict()

function parseDocument(content: PluginUiDocument): PluginUiDocument {
  const result = documentSchema.safeParse(content)
  if (!result.success) throw new PluginError('InvalidPath', 'Plugin UI content is malformed')
  const formIds = new Set<string>()
  const navigationIds = new Set<string>()
  const tableIds = new Set<string>()
  for (const block of flattenPluginUiBlocks(result.data.blocks)) {
    if (block.type === 'navigation-list') {
      if (navigationIds.has(block.id) || new Set(block.items.map(item => item.id)).size !== block.items.length) throw new PluginError('InvalidPath', 'Duplicate navigation list or item ID')
      navigationIds.add(block.id)
    }
    if (block.type === 'table') {
      if (block.id && tableIds.has(block.id)) throw new PluginError('InvalidPath', 'Duplicate table ID')
      if (block.id) tableIds.add(block.id)
      if (block.rowIds && (block.rowIds.length !== block.rows.length || new Set(block.rowIds).size !== block.rowIds.length)) throw new PluginError('InvalidPath', 'Table row IDs must be unique and match row count')
    }
    if (block.type === 'form') {
      if (formIds.has(block.id)) throw new PluginError('InvalidPath', 'Duplicate form ID')
      formIds.add(block.id)
      const ids = new Set<string>()
      for (const field of block.fields) {
        if (field.visibleWhen && !block.fields.some(item => item.id === field.visibleWhen?.field && item.id !== field.id)) throw new PluginError('InvalidPath', 'Invalid visibility condition field')
        if (ids.has(field.id)) throw new PluginError('InvalidPath', 'Duplicate form field ID')
        ids.add(field.id)
        if ((field.type === 'select' || field.type === 'note-picker') && (new Set(field.options.map(option => option.value)).size !== field.options.length
          || (field.value !== undefined && !field.options.some(option => option.value === field.value)))) {
          throw new PluginError('InvalidPath', 'Invalid select options or initial value')
        }
        if (field.type === 'number' && ((field.min !== undefined && field.max !== undefined && field.min > field.max)
          || (field.value !== undefined && ((field.min !== undefined && field.value < field.min) || (field.max !== undefined && field.value > field.max))))) {
          throw new PluginError('InvalidPath', 'Invalid number field bounds')
        }
        if ((field.type === 'text' || field.type === 'textarea' || field.type === 'search' || field.type === 'date') && field.value !== undefined && field.value.length > (field.maxLength ?? 10_000)) {
          throw new PluginError('InvalidPath', 'Initial field value exceeds its limit')
        }
      }
    }
    if (block.type === 'table' && block.rows.some(row => row.length !== block.columns.length)) {
      throw new PluginError('InvalidPath', 'Table row width must match its columns')
    }
    if (block.type === 'tree') {
      const items = new Map(block.items.map(item => [item.id, item]))
      if (items.size !== block.items.length) throw new PluginError('InvalidPath', 'Duplicate tree item ID')
      for (const item of block.items) {
        let parent = item.parentId
        const ancestors = new Set([item.id])
        while (parent !== undefined) {
          if (!items.has(parent) || ancestors.has(parent) || ancestors.size >= 8) throw new PluginError('InvalidPath', 'Tree has an invalid parent, cycle, or depth')
          ancestors.add(parent)
          parent = items.get(parent)?.parentId
        }
      }
    }
  }
  return result.data
}

function serializedUi(value: unknown): string {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('not serializable')
    return serialized
  } catch {
    throw new PluginError('InvalidPath', 'Plugin UI content must be JSON-serializable')
  }
}

export const usePluginUiStore = create<PluginUiState>((set) => ({
  hostRevision: 0,
  embeddedContexts: {},
  views: {},
  hiddenTitleBarViews: [],
  setTitleBarVisible: (key, visible) => set(state => ({ hiddenTitleBarViews: visible ? state.hiddenTitleBarViews.filter(item => item !== key) : [...new Set([...state.hiddenTitleBarViews, key])] })),
  activeRightView: null,
  editorTabs: [],
  activeEditorView: null,
  focusRequest: null,
  dialog: null,
  prompt: null,
  setView: (key, content) => set((state) => ({ views: { ...state.views, [key]: content } })),
  setActiveRightView: (activeRightView) => set({ activeRightView }),
  setActiveEditorView: (key) => set(state => ({
    activeEditorView: key,
    editorTabs: key && !state.editorTabs.includes(key) ? [...state.editorTabs, key] : state.editorTabs,
  })),
  closeEditorView: (key) => set(state => ({
    editorTabs: state.editorTabs.filter(item => item !== key),
    activeEditorView: state.activeEditorView === key ? null : state.activeEditorView,
  })),
  requestFocus: (key) => set(state => ({ focusRequest: { key, sequence: (state.focusRequest?.sequence ?? 0) + 1 } })),
  setDialog: (dialog) => set({ dialog }),
  clearPlugin: (pluginId) => set((state) => ({
    hiddenTitleBarViews: state.hiddenTitleBarViews.filter(key => !key.startsWith(`${pluginId}:`)),
    views: Object.fromEntries(Object.entries(state.views).filter(([key]) => !key.startsWith(`${pluginId}:`))),
    activeRightView: state.activeRightView?.startsWith(`${pluginId}:`) ? null : state.activeRightView,
    editorTabs: state.editorTabs.filter(key => !key.startsWith(`${pluginId}:`)),
    activeEditorView: state.activeEditorView?.startsWith(`${pluginId}:`) ? null : state.activeEditorView,
    focusRequest: state.focusRequest?.key.startsWith(`${pluginId}:`) ? null : state.focusRequest,
    prompt: state.prompt?.pluginId === pluginId ? null : state.prompt,
    dialog: state.dialog?.pluginId === pluginId ? null : state.dialog,
  })),
}))

function declaredView(pluginId: string, viewId: string) {
  const plugin = usePluginStore.getState().installed.find((item) => item.manifest.id === pluginId)
  const view = plugin?.manifest.contributes.views?.find((item) => item.id === viewId)
  if (!view) throw new PluginError('PermissionDenied', `View is not declared: ${viewId}`)
  return view
}

function validateDocumentCommands(pluginId: string, content: PluginUiDocument): void {
  const plugin = usePluginStore.getState().installed.find((item) => item.manifest.id === pluginId)
  const commands = new Set((plugin?.manifest.contributes.commands ?? []).map((item) => item.id))
  for (const block of flattenPluginUiBlocks(content.blocks)) {
    const referenced = block.type === 'form' ? [block.command, ...(block.changeCommand ? [block.changeCommand] : [])]
      : block.type === 'navigation-list' ? [block.openCommand, block.addCommand, block.removeCommand, block.reorderCommand]
      : block.type === 'toolbar' ? block.actions.map(action => action.command)
      : block.type === 'kanban' ? [block.openCardCommand, block.addCardCommand, block.editColumnCommand, block.moveCardCommand, block.reorderColumnsCommand, ...(block.openNoteCommand ? [block.openNoteCommand] : [])]
        : block.type === 'item-list' ? [block.openCommand, block.toggleCommand, block.reorderCommand, ...(block.actions ?? []).map(action => action.command)].filter((command): command is string => Boolean(command))
      : block.type === 'table' ? block.rows.flatMap(row => row.flatMap(cell => typeof cell === 'string' ? [] : [cell.command]))
      : block.type === 'tree' ? block.items.flatMap(item => item.command ? [item.command] : []) : []
    for (const command of referenced) {
      if (!commands.has(command)) throw new PluginError('PermissionDenied', `Undeclared UI command: ${command}`)
    }
    if (block.type !== 'actions') continue
    for (const action of block.actions) {
      if (!commands.has(action.command)) {
        throw new PluginError('PermissionDenied', `UI action references an undeclared command: ${action.command}`)
      }
    }
  }
}

export const embeddedViewLocations = ['new-tab', 'document-top', 'document-bottom', 'file-panel', 'editor-toolbar', 'chat-input', 'record-list', 'status-bar-panel'] as const
export function isEmbeddedViewLocation(location: string): boolean {
  return embeddedViewLocations.some(item => item === location)
}

/** The mounted surface owns its token; old cleanup cannot erase a newer surface. */
export function mountEmbeddedView(key: string, contextId: string): () => void {
  clearPluginForms(key)
  usePluginUiStore.setState(state => ({
    embeddedContexts: { ...state.embeddedContexts, [key]: contextId },
    views: Object.fromEntries(Object.entries(state.views).filter(([id]) => id !== key)),
  }))
  return () => {
    if (usePluginUiStore.getState().embeddedContexts[key] !== contextId) return
    clearPluginForms(key)
    usePluginUiStore.setState(state => ({
      embeddedContexts: Object.fromEntries(Object.entries(state.embeddedContexts).filter(([id]) => id !== key)),
      views: Object.fromEntries(Object.entries(state.views).filter(([id]) => id !== key)),
    }))
  }
}

export function updatePluginView(pluginId: string, viewId: string, content: PluginUiDocument): void {
  const view = declaredView(pluginId, viewId)
  if (isEmbeddedViewLocation(view.location)) {
    const state = getPluginViewState(pluginId, viewId)
    if (!state.visible || !state.contextId || content.expectedContextId !== state.contextId) {
      throw new PluginError('StaleRevision', 'Embedded view context changed; read its current state before updating')
    }
  }
  const parsed = parseDocument(content)
  assertFormSnapshot(`${pluginId}:${viewId}`, parsed.expectedForm)
  validateDocumentCommands(pluginId, parsed)
  const serialized = serializedUi(parsed)
  if (new TextEncoder().encode(serialized).byteLength > 128 * 1024) {
    throw new PluginError('QuotaExceeded', 'Plugin view exceeds its content limit')
  }
  usePluginUiStore.getState().setView(`${pluginId}:${viewId}`, { blocks: parsed.blocks })
  const scope = `${pluginId}:${viewId}`
  const forms = flattenPluginUiBlocks(parsed.blocks).filter(block => block.type === 'form')
  clearPluginForms(scope, new Set(forms.map(form => form.id)))
  for (const form of forms) reconcilePluginForm(scope, form)
}

export async function openPluginView(pluginId: string, viewId: string, assertCurrent: () => void = () => {}, activate = false): Promise<void> {
  assertCurrent()
  const view = declaredView(pluginId, viewId)
  const key = `${pluginId}:${viewId}`
  if (!isPluginDisplayVisible(usePluginStore.getState().deviceSettings, pluginId, view.location)) return
  const sequence = ++navigationSequence
  const initial = usePluginStore.getState()
  const installed = initial.installed.find(plugin => plugin.manifest.id === pluginId)
  if (!installed || !initial.isEnabled(pluginId)) throw new PluginError('Cancelled', 'Plugin is not enabled')
  const fingerprint = getPluginManifestFingerprint(installed)
  let cancelled = false
  let applying = false
  const cancel = () => { if (!applying) cancelled = true }
  const stopSidebar = useSidebarStore.subscribe((state, previous) => {
    if (state.leftSidebarVisible !== previous.leftSidebarVisible || state.rightSidebarVisible !== previous.rightSidebarVisible || state.leftSidebarTab !== previous.leftSidebarTab) cancel()
  })
  const stopUi = usePluginUiStore.subscribe((state, previous) => {
    if (state.activeEditorView !== previous.activeEditorView || state.activeRightView !== previous.activeRightView || state.editorTabs !== previous.editorTabs) cancel()
  })
  const stopSettings = useSettingsDialogStore.subscribe((state, previous) => {
    if (state.open !== previous.open || state.activeSection !== previous.activeSection) cancel()
  })
  if (typeof document !== 'undefined') { document.addEventListener('pointerdown', cancel, true); document.addEventListener('keydown', cancel, true) }
  const guard = () => {
    assertCurrent()
    const current = usePluginStore.getState()
    const plugin = current.installed.find(item => item.manifest.id === pluginId)
    if (!isPluginDisplayVisible(current.deviceSettings, pluginId, view.location) || cancelled || sequence !== navigationSequence || current.currentWorkspaceId !== initial.currentWorkspaceId || current.currentWorkspaceKey !== initial.currentWorkspaceKey || !plugin || !current.isEnabled(pluginId) || getPluginManifestFingerprint(plugin) !== fingerprint) throw new PluginError('Cancelled', 'View navigation was superseded')
  }
  const apply = <T,>(operation: () => T): T => { applying = true; try { return operation() } finally { applying = false } }
  try {
  if (activate) {
    if (!viewActivationResolver) throw new PluginError('Cancelled', 'Plugin host is not running')
    await viewActivationResolver(pluginId)
    guard()
  }
  const sidebar = useSidebarStore.getState()
  if (view.location === 'settings') {
    apply(() => useSettingsDialogStore.getState().openSettings(`plugin:${pluginId}`))
  } else if (view.location === 'left-sidebar') {
    if (!sidebar.leftSidebarVisible) await apply(() => sidebar.toggleLeftSidebar())
    guard()
    await apply(() => sidebar.setLeftSidebarTab(key))
  } else if (view.location === 'right-sidebar') {
    if (!sidebar.rightSidebarVisible) await apply(() => sidebar.toggleRightSidebar())
    guard()
    apply(() => usePluginUiStore.getState().setActiveRightView(key))
  } else if (view.location.startsWith('title-bar-') || isEmbeddedViewLocation(view.location)) {
    apply(() => usePluginUiStore.getState().setTitleBarVisible(key, true))
  } else {
    const { prepareActiveEditorDeactivationDurably } = await import('@/lib/editor-deactivation')
    if (!await prepareActiveEditorDeactivationDurably(useArticleStore.getState().activeFilePath)) throw new PluginError('EditorBusy', 'The editor cannot be deactivated safely')
    guard()
    apply(() => usePluginUiStore.getState().setActiveEditorView(key))
  }
  guard()
  usePluginUiStore.getState().requestFocus(key)
  } finally {
    stopSidebar(); stopUi(); stopSettings()
    if (typeof document !== 'undefined') { document.removeEventListener('pointerdown', cancel, true); document.removeEventListener('keydown', cancel, true) }
  }
}

export function openPluginDialog(pluginId: string, options: PluginDialogOptions): PluginDialogHandle {
  if (usePluginUiStore.getState().prompt) throw new PluginError('Conflict', 'A prompt is already open')
  const result = dialogSchema.safeParse(options)
  if (!result.success) throw new PluginError('InvalidPath', 'Plugin dialog content is malformed')
  parseDocument(result.data.content)
  if (result.data.content.expectedForm) throw new PluginError('StaleRevision', 'A new dialog has no form snapshot')
  validateDocumentCommands(pluginId, result.data.content)
  const serialized = serializedUi(result.data)
  if (new TextEncoder().encode(serialized).byteLength > 128 * 1024) {
    throw new PluginError('QuotaExceeded', 'Plugin dialog exceeds its content limit')
  }
  const previous = usePluginUiStore.getState().dialog
  if (previous && (previous.pluginId !== pluginId || result.data.replaceId !== previous.id)) throw new PluginError('Conflict', 'A dialog is already open; explicitly replace your own current dialog')
  if (!previous && result.data.replaceId !== undefined) throw new PluginError('NotFound', 'The dialog to replace is no longer open')
  if (previous) dismissPluginDialog(previous.id, 'replaced')
  const id = crypto.randomUUID()
  usePluginUiStore.getState().setDialog({ ...result.data, pluginId, id })
  return { id }
}

export async function closePluginView(pluginId: string, viewId: string): Promise<void> {
  cancelPluginViewNavigation()
  const view = declaredView(pluginId, viewId)
  const key = `${pluginId}:${viewId}`
  clearPluginForms(key)
  const state = usePluginUiStore.getState()
  if (view.location === 'settings') {
    const settings = useSettingsDialogStore.getState()
    if (settings.activeSection === `plugin:${pluginId}`) settings.closeSettings()
  } else if (view.location.startsWith('title-bar-') || isEmbeddedViewLocation(view.location)) state.setTitleBarVisible(key, false)
  else if (view.location === 'editor-tab') state.closeEditorView(key)
  else if (view.location === 'right-sidebar' && state.activeRightView === key) state.setActiveRightView(null)
  else if (view.location === 'left-sidebar' && useSidebarStore.getState().leftSidebarTab === key) await useSidebarStore.getState().setLeftSidebarTab('files')
}

export function getPluginViewState(pluginId: string, viewId: string): PluginViewState {
  const view = declaredView(pluginId, viewId)
  const key = `${pluginId}:${viewId}`
  const state = usePluginUiStore.getState()
  const sidebar = useSidebarStore.getState()
  const settings = useSettingsDialogStore.getState()
  const visible = isEmbeddedViewLocation(view.location) ? Boolean(state.embeddedContexts[key]) && !state.hiddenTitleBarViews.includes(key) && usePluginStore.getState().isEnabled(pluginId)
    : view.location === 'settings' ? settings.open && settings.activeSection === `plugin:${pluginId}` && usePluginStore.getState().isEnabled(pluginId)
    : view.location.startsWith('title-bar-') ? !state.hiddenTitleBarViews.includes(key)
    : view.location === 'editor-tab' ? state.activeEditorView === key
    : view.location === 'left-sidebar' ? sidebar.leftSidebarVisible && sidebar.leftSidebarTab === key
      : sidebar.rightSidebarVisible && state.activeRightView === key
  return { id: viewId, location: view.location, visible: visible && isPluginDisplayVisible(usePluginStore.getState().deviceSettings, pluginId, view.location), ...(isEmbeddedViewLocation(view.location) && state.embeddedContexts[key] ? { contextId: state.embeddedContexts[key] } : {}) }
}

export function onPluginViewChange(pluginId: string, listener: (state: PluginViewState) => void | Promise<void>): PluginDisposable {
  const views = usePluginStore.getState().installed.find(plugin => plugin.manifest.id === pluginId)?.manifest.contributes.views ?? []
  const previous = new Map(views.map(view => [view.id, JSON.stringify(getPluginViewState(pluginId, view.id))]))
  const emitChanges = () => {
    for (const view of views) {
      try {
        const state = getPluginViewState(pluginId, view.id)
        const snapshot = JSON.stringify(state)
        if (previous.get(view.id) === snapshot) continue
        previous.set(view.id, snapshot)
        void Promise.resolve().then(() => listener(state)).catch(() => undefined)
      } catch { /* The plugin may have been removed. */ }
    }
  }
  const stopUi = usePluginUiStore.subscribe(emitChanges)
  const stopSidebar = useSidebarStore.subscribe(emitChanges)
  const stopPreferences = usePluginStore.subscribe(emitChanges)
  const stopSettings = useSettingsDialogStore.subscribe(emitChanges)
  return { dispose: () => { stopUi(); stopSidebar(); stopPreferences(); stopSettings() } }
}

export function closePluginDialog(pluginId: string, id: string): void {
  const state = usePluginUiStore.getState()
  if (state.dialog?.pluginId === pluginId && state.dialog.id === id) dismissPluginDialog(id, 'programmatic')
}

export function updatePluginDialog(pluginId: string, id: string, options: PluginDialogUpdate): void {
  const current = usePluginUiStore.getState().dialog
  if (!current || current.pluginId !== pluginId || current.id !== id) throw new PluginError('NotFound', 'Dialog is no longer open')
  const result = dialogSchema.omit({ replaceId: true }).safeParse(options)
  if (!result.success) throw new PluginError('InvalidPath', 'Plugin dialog content is malformed')
  const content = parseDocument(result.data.content)
  validateDocumentCommands(pluginId, content)
  if (new TextEncoder().encode(serializedUi(result.data)).byteLength > 128 * 1024) throw new PluginError('QuotaExceeded', 'Plugin dialog exceeds its content limit')
  const scope = `${pluginId}:dialog:${id}`
  assertFormSnapshot(scope, content.expectedForm)
  const forms = flattenPluginUiBlocks(content.blocks).filter(block => block.type === 'form')
  clearPluginForms(scope, new Set(forms.map(form => form.id)))
  for (const form of forms) reconcilePluginForm(scope, form)
  usePluginUiStore.getState().setDialog({ ...result.data, content: { blocks: content.blocks }, pluginId, id })
}

function assertFormSnapshot(scope: string, expected: PluginUiDocument['expectedForm']): void {
  if (!expected) return
  const current = usePluginFormStore.getState().sessions[pluginFormKey(scope, expected.formId)]
  if (!current || current.generation !== expected.generation || current.changeRevision !== expected.revision) {
    throw new PluginError('StaleRevision', 'Form input changed; discard this UI result')
  }
}

export function clearPluginUi(pluginId: string, preserveViewLocations = false): void {
  cancelPluginViewNavigation()
  const dialog = usePluginUiStore.getState().dialog
  if (dialog?.pluginId === pluginId) dismissPluginDialog(dialog.id, 'disposed')
  clearAllPluginForms(pluginId)
  if (preserveViewLocations) {
    usePluginUiStore.setState(state => ({
      views: Object.fromEntries(Object.entries(state.views).filter(([key]) => !key.startsWith(`${pluginId}:`))),
      focusRequest: state.focusRequest?.key.startsWith(`${pluginId}:`) ? null : state.focusRequest,
    }))
  } else usePluginUiStore.getState().clearPlugin(pluginId)
  const sidebar = useSidebarStore.getState()
  if (!preserveViewLocations && sidebar.leftSidebarTab.startsWith(`${pluginId}:`)) {
    void sidebar.setLeftSidebarTab('files').catch(error => {
      usePluginStore.getState().addLog({
        pluginId,
        level: 'warning',
        message: `Plugin UI was closed, but its sidebar preference could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      })
    })
  }
}


const promptBase = { title: z.string().min(1).max(240), description: z.string().max(2000).optional(), confirmLabel: z.string().min(1).max(80).optional() }
const promptSchema = z.discriminatedUnion('type', [
  z.object({ ...promptBase, type: z.literal('confirm') }).strict(),
  z.object({ ...promptBase, type: z.literal('select'), multiple: z.boolean().optional(), options: z.array(z.object({ value: z.string().min(1).max(160), label: z.string().min(1).max(240) }).strict()).min(1).max(100) }).strict(),
])
const promptResolvers = new Map<string, (value: PluginPromptResult) => void>()
export function finishPluginPrompt(id: string, value: PluginPromptResult): void {
  const prompt = usePluginUiStore.getState().prompt
  if (prompt?.id !== id) return
  if (value !== null) {
    if (prompt.options.type === 'confirm' && typeof value !== 'boolean') return
    const selection = prompt.options.type === 'select' ? prompt.options : null
    if (selection && (!Array.isArray(value) || (!selection.multiple && value.length !== 1) || new Set(value).size !== value.length || value.some(item => !selection.options.some(option => option.value === item)))) return
  }
  promptResolvers.get(id)?.(value)
}
export function requestPluginPrompt(pluginId: string, options: PluginPromptOptions, signal: AbortSignal): Promise<PluginPromptResult> {
  const parsed = promptSchema.safeParse(options)
  if (!parsed.success || (parsed.data.type === 'select' && new Set(parsed.data.options.map(option => option.value)).size !== parsed.data.options.length)) throw new PluginError('InvalidPath', 'Invalid prompt options')
  if (signal.aborted) throw new PluginError('Cancelled', 'Plugin stopped')
  const state = usePluginUiStore.getState()
  if (state.dialog || state.prompt) throw new PluginError('Conflict', 'A plugin dialog is already open')
  const id = crypto.randomUUID()
  return new Promise(resolve => {
    let finished = false
    const finish = (value: PluginPromptResult) => {
      if (finished) return
      finished = true
      stop()
      signal.removeEventListener('abort', abort)
      promptResolvers.delete(id)
      if (usePluginUiStore.getState().prompt?.id === id) usePluginUiStore.setState({ prompt: null })
      resolve(value)
    }
    const abort = () => finish(null)
    const stop = usePluginUiStore.subscribe(next => { if (next.prompt?.id !== id) finish(null) })
    promptResolvers.set(id, finish)
    signal.addEventListener('abort', abort)
    usePluginUiStore.setState({ prompt: { id, pluginId, options: parsed.data } })
  })
}
