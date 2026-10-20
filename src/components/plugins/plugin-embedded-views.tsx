'use client'

import type { PluginEmbeddedViewLocation, PluginViewState } from '@notegen/plugin-api'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { usePluginStore } from '@/stores/plugins'
import { mountEmbeddedView, usePluginUiStore } from '@/lib/plugins/ui-registry'
import { isPluginEnabledInWorkspace } from '@/lib/plugins/internal-types'
import { isPluginDisplayVisible } from '@/lib/plugins/display-preferences'
import { usePluginLocalization } from '@/lib/plugins/localization'
import { resolvePluginViewTitle } from '@/app/core/setting/plugins/plugin-display'
import { canUsePluginPermission } from '@/lib/plugins/broker'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Puzzle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Editor } from '@tiptap/core'
import { createPortal } from 'react-dom'
import { PluginViewSurface } from './plugin-view-surface'

export function useEmbeddedPluginViews(location: PluginEmbeddedViewLocation) {
  const locale = useLocale()
  const installed = usePluginStore(state => state.installed)
  const workspaceId = usePluginStore(state => state.currentWorkspaceId)
  const workspaceStates = usePluginStore(state => state.workspaceStates)
  const settings = usePluginStore(state => state.deviceSettings)
  usePluginLocalization(installed, locale)
  return [...installed].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)).flatMap(plugin => {
    const state = workspaceId ? workspaceStates[workspaceId]?.[plugin.manifest.id] : undefined
    if (!isPluginEnabledInWorkspace(plugin, state) || !isPluginDisplayVisible(settings, plugin.manifest.id, location)) return []
    const required = location === 'file-selection-panel' ? 'notes.list'
      : location === 'record-detail' ? 'records.read'
        : location === 'chat-message-actions' ? 'chat.read' : null
    if (required && !canUsePluginPermission(plugin.manifest.id, required)) return []
    return (plugin.manifest.contributes.views ?? []).filter(view => view.location === location).map(view => ({
      key: `${plugin.manifest.id}:${view.id}`, pluginId: plugin.manifest.id, view, hash: plugin.contentHash,
      title: resolvePluginViewTitle(plugin, view, locale, state?.settings),
    }))
  })
}

type EmbeddedView = ReturnType<typeof useEmbeddedPluginViews>[number]
const EDITOR_CARET_TARGET = { kind: 'editor-caret' } as const

/** A view belongs to one visible host context at a time, never a hidden editor tab. */
export function PluginEmbeddedView({ item, contextKey = '', compact = false, card = true, popover = false, target }: {
  item: EmbeddedView; contextKey?: string; compact?: boolean; card?: boolean; popover?: boolean; target?: PluginViewState['target']
}) {
  const container = useRef<HTMLDivElement>(null)
  const workspace = usePluginStore(state => state.currentWorkspaceId)
  const listGrant = usePluginStore(state => workspace ? state.workspaceStates[workspace]?.[item.pluginId]?.permissions['notes.list'] : undefined)
  const recordGrant = usePluginStore(state => workspace ? state.workspaceStates[workspace]?.[item.pluginId]?.permissions['records.read'] : undefined)
  const chatGrant = usePluginStore(state => workspace ? state.workspaceStates[workspace]?.[item.pluginId]?.permissions['chat.read'] : undefined)
  const revision = usePluginUiStore(state => state.hostRevision)
  const hidden = usePluginUiStore(state => state.hiddenTitleBarViews.includes(item.key))
  const [visible, setVisible] = useState(false)
  const [placeholderHeight, setPlaceholderHeight] = useState(0)
  const focus = usePluginUiStore(state => state.focusRequest)
  const viewContent = usePluginUiStore(state => state.views[item.key])
  const headless = item.view.location === 'editor/selection-panel' && (!viewContent?.blocks.length || viewContent.blocks.some(block => !['toolbar', 'actions', 'text', 'badge', 'loading', 'separator', 'progress'].includes(block.type)))
  useEffect(() => {
    if (!hidden && focus?.key === item.key) container.current?.scrollIntoView({ block: 'nearest' })
  }, [focus, hidden, item.key])
  const contextId = useMemo(() => crypto.randomUUID(), [item.key, item.hash, workspace, contextKey, target, revision, visible, hidden, listGrant, recordGrant, chatGrant])
  useEffect(() => {
    const node = container.current
    if (!node || hidden) { setVisible(false); return }
    const observer = new IntersectionObserver(entries => {
      const next = entries.some(entry => entry.isIntersecting)
      if (!next) setPlaceholderHeight(node.getBoundingClientRect().height)
      setVisible(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hidden])
  useLayoutEffect(() => {
    if (!visible || hidden) return
    const authorizedTarget = target?.kind === 'file-selection' ? {
      ...target,
      entries: target.entries.filter(entry => canUsePluginPermission(item.pluginId, 'notes.list', entry.path)),
    } : target?.kind === 'record' && !canUsePluginPermission(item.pluginId, 'records.read') ? undefined
      : target?.kind === 'chat-message' && !canUsePluginPermission(item.pluginId, 'chat.read') ? undefined : target
    return mountEmbeddedView(item.key, contextId, authorizedTarget)
  }, [item.key, item.pluginId, contextId, visible, hidden, target])
  if (hidden) return null
  const content = visible ? <PluginViewSurface key={contextId} viewKey={item.key} compact={compact} forcePopover={popover} title={item.title} icon={item.view.icon} /> : null
  return <div ref={container} style={!visible && placeholderHeight ? { minHeight: placeholderHeight } : undefined} className={compact ? headless ? 'absolute left-0 top-4 size-px' : 'min-h-6 min-w-6 shrink-0' : 'min-h-8 min-w-0'}>
    {card && !compact ? <Card><CardHeader><CardTitle>{item.title}</CardTitle></CardHeader><CardContent>{content}</CardContent></Card> : content}
  </div>
}

export function PluginEmbeddedViews({ location, active = true, contextKey = '', compact = false, popover = false, target }: {
  location: PluginEmbeddedViewLocation; active?: boolean; contextKey?: string; compact?: boolean; popover?: boolean; target?: PluginViewState['target']
}) {
  const items = useEmbeddedPluginViews(location)
  const visibleItems = location === 'file-selection-panel' && target?.kind === 'file-selection'
    ? items.filter(item => target.entries.some(entry => canUsePluginPermission(item.pluginId, 'notes.list', entry.path)))
    : items
  if (!active || !visibleItems.length) return null
  return <div className={compact ? 'relative flex min-w-0 shrink-0 items-center gap-1' : 'flex max-h-[40vh] min-w-0 shrink-0 flex-col gap-3 overflow-auto p-2'}>
    {visibleItems.map(item => <PluginEmbeddedView key={item.key} item={item} contextKey={contextKey} compact={compact} popover={popover} target={target} />)}
  </div>
}

/** One message owns the actions surface at a time, so its view token cannot point at another message. */
export function PluginChatMessageActions({ conversationId, messageId, role, messageType }: {
  conversationId?: number; messageId: number; role: 'user' | 'system'; messageType: string
}) {
  const views = useEmbeddedPluginViews('chat-message-actions')
  const t = useTranslations('settings.plugins.ui')
  const workspaceId = usePluginStore(state => state.currentWorkspaceId)
  const key = `${workspaceId ?? ''}:${conversationId ?? 0}:${messageId}`
  const active = usePluginUiStore(state => state.activeChatMessageKey === key)
  const setActive = usePluginUiStore(state => state.setActiveChatMessageKey)
  const target = useMemo(() => ({ kind: 'chat-message' as const, id: messageId, role, messageType }), [messageId, role, messageType])
  if (!views.length) return null
  return <div className="flex flex-col items-end gap-1">
    <Button type="button" size="icon-sm" variant="ghost" title={t('moreActions')} aria-label={t('moreActions')} aria-expanded={active} onClick={() => setActive(active ? null : key)}><Puzzle /></Button>
    {active ? <PluginEmbeddedViews location="chat-message-actions" contextKey={key} target={target} compact /> : null}
  </div>
}

/** The host anchors one compact surface to the active caret and invalidates it on editor changes. */
export function PluginEditorInlineViews({ editor }: { editor: Editor }) {
  const views = useEmbeddedPluginViews('editor-inline')
  const hasViews = views.length > 0
  const [anchor, setAnchor] = useState<{ left: number; top: number; sequence: number } | null>(null)
  const context = useRef<{ doc: Editor['state']['doc']; from: number; sequence: number } | null>(null)
  useEffect(() => {
    if (!hasViews) return
    const update = () => {
      if (editor.isDestroyed || !editor.view.hasFocus() || !editor.state.selection.empty || editor.view.composing) {
        setAnchor(null)
        context.current = null
        return
      }
      const viewport = editor.view.dom.closest<HTMLElement>('.editor-scroll-container')?.getBoundingClientRect()
      let coords: ReturnType<typeof editor.view.coordsAtPos>
      try { coords = editor.view.coordsAtPos(editor.state.selection.from) }
      catch { setAnchor(null); context.current = null; return }
      if (viewport && (coords.top < viewport.top || coords.bottom > viewport.bottom)) {
        setAnchor(null)
        context.current = null
        return
      }
      const from = editor.state.selection.from
      const previous = context.current
      const sequence = previous && previous.doc === editor.state.doc && previous.from === from ? previous.sequence : (previous?.sequence ?? 0) + 1
      context.current = { doc: editor.state.doc, from, sequence }
      const left = Math.max(8, Math.min(coords.left, window.innerWidth - 64))
      const top = Math.max(8, Math.min(coords.bottom + 6, window.innerHeight - 48))
      setAnchor(current => current?.left === left && current.top === top && current.sequence === sequence ? current : { left, top, sequence })
    }
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    editor.on('focus', update)
    editor.on('blur', update)
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    update()
    return () => {
      context.current = null
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
      editor.off('focus', update)
      editor.off('blur', update)
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [editor, hasViews])
  if (!hasViews || !anchor) return null
  return createPortal(<div className="fixed z-40 rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10" style={{ left: anchor.left, top: anchor.top }} onMouseDown={event => event.preventDefault()}>
    <PluginEmbeddedViews location="editor-inline" contextKey={String(anchor.sequence)} target={EDITOR_CARET_TARGET} compact />
  </div>, document.body)
}
