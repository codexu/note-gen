'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BookOpen, RefreshCw, Settings, Sparkles, X, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ContextMenuGroup, ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard, getWikiContext, subscribeWikiWorkspaceChanges } from '@/lib/wiki/context'
import { getMarkById } from '@/db/marks'
import emitter from '@/lib/emitter'
import { addWikiScope, getWikiSettings, isWikiArticlePathSelected, removeWikiScope } from '@/lib/wiki/settings'
import { getWikiFolderSelection, setWikiFolderEnabled, startWikiFolderCompilation } from '@/lib/wiki/folders'
import { rebuildWikiPage, startWikiCompilation } from '@/lib/wiki/queue'
import { getWikiPageForFilePath, WIKI_ROOT_FOLDER } from '@/lib/wiki/files'
import type { WikiPage, WikiScopeKind } from '@/types/wiki'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { useWikiNavigation } from './use-wiki-navigation'
import { useWikiActionScope } from './use-wiki-action-scope'
import { useWikiErrorMessage } from './use-wiki-error-message'

interface WikiMenuState {
  contextId: string
  isCurrent: () => boolean
  enabled: boolean
  started: boolean
  paused: boolean
  hasOverrides: boolean
  normalizedId: string | null
  scopeKey: string | null
  pathIncluded: boolean
  generatedPage: WikiPage | null
}

export function WikiMenuItems({ kind, id, label, sourceKey, variant = 'context', disabled = false, local = true, onDismiss }: {
  kind: WikiScopeKind
  id: string
  label: string
  sourceKey?: string
  variant?: 'context' | 'dropdown' | 'drawer'
  disabled?: boolean
  local?: boolean
  onDismiss?: () => void
}) {
  const t = useTranslations('wiki')
  const folderText = useTranslations('article.file.folderView')
  const errorMessage = useWikiErrorMessage()
  const router = useRouter()
  const { openPage, openFolder } = useWikiNavigation()
  const { busy, beginAction, getActionGuard } = useWikiActionScope(JSON.stringify([kind, id, label]))
  const [menuState, setMenuState] = useState<WikiMenuState | null>(null)
  const menu = menuState?.isCurrent() ? menuState : null
  const scopeKey = menu?.scopeKey ?? null
  const pathIncluded = menu?.pathIncluded ?? false
  const generatedPage = menu?.generatedPage ?? null
  const normalizedPath = id.replace(/\\/g, '/').replace(/\/$/, '')
  const isWikiPath = (kind === 'article' || kind === 'article-folder')
    && (normalizedPath === WIKI_ROOT_FOLDER || normalizedPath.startsWith(`${WIKI_ROOT_FOLDER}/`))

  useEffect(() => {
    let active = true
    let request = 0
    setMenuState(null)
    const refresh = async () => {
      const current = ++request
      const isCurrent = getActionGuard()
      const context = await getWikiContext()
      if (!active || !isCurrent() || current !== request) return
      const [settings, page] = await Promise.all([
        getWikiSettings(context.id),
        kind === 'article' ? getWikiPageForFilePath(id) : Promise.resolve(null),
      ])
      const normalizedId = kind === 'record' && /^\d+$/.test(id)
        ? (await getMarkById(Number(id)))?.sourceId ?? null : id
      // Stable record IDs are accepted by addWikiScope; local IDs are normalized there.
      const match = settings.scopes.find(scope => scope.kind === kind && scope.enabled && scope.effect !== 'exclude'
        && (scope.id === normalizedId || (kind === 'record-tag' && scope.label === label)))
      await assertWikiContextCurrent(context.id)
      if (active && isCurrent() && current === request) {
        const folder = kind === 'article-folder' ? getWikiFolderSelection(id, settings) : null
        setMenuState({
          contextId: context.id, isCurrent, scopeKey: match?.key || null,
          enabled: settings.enabled, started: settings.started, paused: settings.paused,
          normalizedId, hasOverrides: folder?.hasOverrides ?? false,
          pathIncluded: folder?.included ?? (kind === 'article' && isWikiArticlePathSelected(id, settings)),
          generatedPage: page,
        })
      }
    }
    const update = () => { void refresh().catch(() => {}) }
    update()
    const unsubscribeWorkspace = subscribeWikiWorkspaceChanges(() => {
      setMenuState(null)
      update()
    })
    window.addEventListener('wiki-updated', update)
    return () => {
      active = false
      request++
      unsubscribeWorkspace()
      window.removeEventListener('wiki-updated', update)
    }
  }, [id, kind, label, getActionGuard])

  function openSettings() {
    if (window.location.pathname.startsWith('/mobile')) router.push('/mobile/setting/pages/rag')
    else useSettingsDialogStore.getState().openSettings('rag')
  }

  async function run(action: (contextId: string, isCurrent: () => boolean) => Promise<unknown>) {
    if (!menu?.isCurrent()) return
    // Radix and the mobile drawer unmount their items as soon as a command is selected.
    const isCurrent = captureWikiWorkspaceGuard()
    const operation = beginAction()
    try {
      await assertWikiContextCurrent(menu.contextId)
      if (isCurrent()) await action(menu.contextId, isCurrent)
    } catch (error) {
      if (isCurrent()) toast.error(t('failed'), { description: errorMessage(error) })
    } finally { operation.finish() }
  }

  function viewRelated() {
    if (!menu?.isCurrent()) return
    if (generatedPage) return run(contextId => openPage(generatedPage.id, contextId))
    if (isWikiPath) return run(contextId => openFolder(contextId))
    const isCurrent = captureWikiWorkspaceGuard()
    emitter.emit('wiki-show-related-files', {
      key: crypto.randomUUID(), contextId: menu.contextId, isCurrent, route: window.location.pathname,
      kind, id: menu.normalizedId, label, sourceKey, local, organize: () => organize(menu.contextId, isCurrent),
    })
  }

  async function toggle() {
    await run(async (contextId, isCurrent) => {
      const pathScope = kind === 'article' || kind === 'article-folder'
      const included = pathScope ? pathIncluded : Boolean(scopeKey)
      if (kind === 'article-folder') {
        await setWikiFolderEnabled(id, !included, contextId)
        if (isCurrent()) toast.success(t(included ? 'removedScope' : 'addedScope'))
      } else if (kind === 'article') {
        await addWikiScope({ kind, id, label, effect: included ? 'exclude' : 'include' }, contextId)
        if (isCurrent()) toast.success(t(included ? 'removedScope' : 'addedScope'))
      } else if (scopeKey) {
        await removeWikiScope(scopeKey, contextId)
        if (isCurrent()) toast.success(t('removedScope'))
      } else {
        await addWikiScope({ kind, id, label }, contextId)
        if (!isCurrent()) return
        const settings = await getWikiSettings(contextId)
        if (isCurrent()) toast.success(t('addedScope'), { description: settings.started ? undefined : t('scopeAddedDescription') })
      }
    })
  }

  async function organize(contextId: string, isCurrent: () => boolean) {
    if (!isCurrent()) return
    const settings = await getWikiSettings(contextId)
    if (!isCurrent()) return
    if (!settings.enabled || (generatedPage && (!settings.started || settings.paused))) {
      openSettings()
      return
    }
    if (generatedPage) {
      await rebuildWikiPage(generatedPage.id, contextId)
    } else if (kind === 'article-folder') {
      await startWikiFolderCompilation(id, contextId)
      if (isCurrent()) toast.success(folderText('organizeQueued'))
    } else {
      await addWikiScope({ kind, id, label }, contextId)
      if (isCurrent()) await startWikiCompilation(contextId)
    }
  }

  const Group = variant === 'dropdown' ? DropdownMenuGroup : ContextMenuGroup
  const MenuItem = variant === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const included = kind === 'article' || kind === 'article-folder' ? pathIncluded : Boolean(scopeKey)
  const source = !isWikiPath && !generatedPage
  const actions: { label: string; icon: LucideIcon; select: () => void | Promise<void> }[] = []
  if (source && menu?.enabled) {
    actions.push({ label: included ? t('removeScope') : kind === 'article-folder' ? folderText('wikiSourceToggle') : t('addToWiki'),
      icon: included ? X : Sparkles, select: toggle })
  }
  actions.push({ label: t('viewRelated'), icon: BookOpen, select: viewRelated })
  if ((source || generatedPage) && menu?.enabled && local) {
    let organizationLabel = kind === 'article-folder' ? folderText('updateFolder') : t('updateSource')
    if (generatedPage) organizationLabel = t('rebuild')
    else if (kind === 'article-folder' && !included) organizationLabel = t('includeAndOrganize')
    else if (menu.paused) organizationLabel = t('resume')
    else if (!menu.started) organizationLabel = t('start')
    actions.push({ label: organizationLabel, icon: RefreshCw, select: () => run(organize) })
  }
  if (menu && (!menu.enabled || variant === 'drawer')) {
    actions.push({ label: folderText('openKnowledgeSettings'), icon: Settings, select: openSettings })
  }
  const locked = disabled || busy || !menu
  if (variant === 'drawer') return <div className="flex flex-col">
    {source && menu?.enabled && menu.hasOverrides ? <p className="px-3 py-2 text-xs text-muted-foreground">{folderText('wikiOverrides')}</p> : null}
    {source && kind === 'article-folder' && menu?.enabled && !menu.started ? <p className="px-3 py-2 text-xs text-muted-foreground">{folderText('startMaintenanceHint')}</p> : null}
    {source && kind === 'article-folder' && menu && !menu.enabled ? <p className="px-3 py-2 text-xs text-muted-foreground">{folderText('wikiGlobalDisabled')}</p> : null}
    {source && !local && <p className="px-3 py-2 text-xs text-muted-foreground">{t('statuses.unavailable')}</p>}
    {actions.map(({ label: actionLabel, icon: Icon, select }) => <Button
      key={actionLabel} type="button" variant="ghost" disabled={locked} className="h-12 justify-start px-3"
      onClick={() => { void select(); onDismiss?.() }}
    ><Icon />{actionLabel}</Button>)}
  </div>
  return <Group>{actions.map(({ label: actionLabel, icon: Icon, select }) => <MenuItem
    key={actionLabel} disabled={locked} onSelect={() => void select()}
  ><Icon />{actionLabel}</MenuItem>)}</Group>
}
