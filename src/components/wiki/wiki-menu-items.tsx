'use client'

import { useWikiErrorMessage } from './use-wiki-error-message'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BookOpen, RefreshCw, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { ContextMenuGroup, ContextMenuItem } from '@/components/ui/context-menu'
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { assertWikiContextCurrent, getWikiContext, subscribeWikiWorkspaceChanges } from '@/lib/wiki/context'
import { getMarkById } from '@/db/marks'
import { listWikiPages } from '@/db/wiki'
import { addWikiScope, getWikiSettings, isWikiArticlePathSelected, removeWikiScope } from '@/lib/wiki/settings'
import { getWikiFolderSelection, setWikiFolderEnabled, startWikiFolderCompilation } from '@/lib/wiki/folders'
import { rebuildWikiPage, startWikiCompilation } from '@/lib/wiki/queue'
import { getWikiPageForFilePath, WIKI_ROOT_FOLDER } from '@/lib/wiki/files'
import type { WikiPage, WikiScopeKind } from '@/types/wiki'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { useWikiNavigation } from './use-wiki-navigation'
import { useWikiActionScope } from './use-wiki-action-scope'

interface WikiMenuState {
  contextId: string
  isCurrent: () => boolean
  scopeKey: string | null
  pathIncluded: boolean
  generatedPage: WikiPage | null
}

export function WikiMenuItems({ kind, id, label, sourceKey, variant = 'context', disabled = false }: {
  kind: WikiScopeKind
  id: string
  label: string
  sourceKey?: string
  variant?: 'context' | 'dropdown'
  disabled?: boolean
}) {
  const t = useTranslations('wiki')
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
        ? (await getMarkById(Number(id)))?.sourceId || id : id
      // Stable record IDs are accepted by addWikiScope; local IDs are normalized there.
      const match = settings.scopes.find(scope => scope.kind === kind && scope.enabled && scope.effect !== 'exclude'
        && (scope.id === normalizedId || (kind === 'record-tag' && scope.label === label)))
      await assertWikiContextCurrent(context.id)
      if (active && isCurrent() && current === request) {
        setMenuState({
          contextId: context.id, isCurrent, scopeKey: match?.key || null,
          pathIncluded: kind === 'article-folder' ? getWikiFolderSelection(id, settings).included
            : kind === 'article' && isWikiArticlePathSelected(id, settings),
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

  async function run(action: (contextId: string, isCurrent: () => boolean) => Promise<void>) {
    if (!menu) return
    const operation = beginAction()
    try {
      await assertWikiContextCurrent(menu.contextId)
      if (!operation.isCurrent() || !menu.isCurrent()) return
      await action(menu.contextId, operation.isCurrent)
    } catch (error) {
      if (operation.isCurrent()) toast.error(t('failed'), { description: errorMessage(error) })
    } finally { operation.finish() }
  }

  async function viewRelated() {
    await run(async (contextId, isCurrent) => {
      if (generatedPage) {
        await openPage(generatedPage.id, contextId)
        return
      }
      if (isWikiPath) {
        await openFolder(contextId)
        return
      }
      const normalizedId = kind === 'record' && /^\d+$/.test(id)
        ? (await getMarkById(Number(id)))?.sourceId || id : id
      if (!isCurrent()) return
      const folder = id.replace(/\/$/, '')
      const tag = label.normalize('NFKC')
      const pages = (await listWikiPages(contextId)).filter(page => page.status !== 'archived' && page.sourceRefs.some(source => {
        if (kind === 'article-folder') return source.sourceType === 'article'
          && (!folder || source.locator.filePath?.startsWith(`${folder}/`))
        if (kind === 'record-tag') return source.tagKeys?.some(key => key === tag || key.startsWith(`${tag}/`))
        if (kind === 'source-type') return source.sourceType === id
        return source.sourceKey === sourceKey || source.stableId === `${kind}:${normalizedId}`
          || source.stableId === normalizedId
      })).sort((left, right) => Number(left.kind !== 'source') - Number(right.kind !== 'source'))
      await assertWikiContextCurrent(contextId)
      if (!isCurrent()) return
      if (pages.length) await openPage(pages[0].id, contextId)
      else await openFolder(contextId)
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

  async function update() {
    await run(async (contextId, isCurrent) => {
      if (generatedPage) {
        const settings = await getWikiSettings(contextId)
        if (!isCurrent()) return
        if (!settings.enabled || !settings.started || settings.paused) {
          openSettings()
          return
        }
        await rebuildWikiPage(generatedPage.id, contextId)
        return
      }
      const settings = await getWikiSettings(contextId)
      if (!isCurrent()) return
      if (!settings.enabled) { openSettings(); return }
      if (kind === 'article-folder') await startWikiFolderCompilation(id, contextId)
      else {
        await addWikiScope({ kind, id, label }, contextId)
        if (!isCurrent()) return
        await startWikiCompilation(contextId)
      }
    })
  }

  const Group = variant === 'dropdown' ? DropdownMenuGroup : ContextMenuGroup
  const MenuItem = variant === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const included = kind === 'article' || kind === 'article-folder' ? pathIncluded : Boolean(scopeKey)
  return <Group>
    {!isWikiPath && !generatedPage ? <MenuItem disabled={disabled || busy || !menu} onSelect={() => void toggle()}>{included ? <X /> : <Sparkles />}{included ? t('removeScope') : t('addToWiki')}</MenuItem> : null}
    <MenuItem disabled={disabled || busy || !menu} onSelect={() => void viewRelated()}><BookOpen />{t('viewRelated')}</MenuItem>
    {!isWikiPath || generatedPage ? <MenuItem disabled={disabled || busy || !menu} onSelect={() => void update()}><RefreshCw />{generatedPage ? t('rebuild') : t('updateSource')}</MenuItem> : null}
  </Group>
}
