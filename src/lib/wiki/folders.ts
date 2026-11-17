import { collectMarkdownFiles } from '@/lib/files'
import { WIKI_ROOT_FOLDER, type WikiSettings } from '@/types/wiki'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard, getWikiContext } from './context'
import {
  getWikiArticleRule, getWikiSettings, isWikiArticlePathSelected, normalizeWikiScopeId,
  setWikiFolderScope, updateWikiSettings,
} from './settings'

export interface WikiFolderSelection {
  included: boolean
  inheritedFrom: string | null
  hasOverrides: boolean
  generated: boolean
}

export function getWikiFolderSelection(folderPath: string, settings: WikiSettings): WikiFolderSelection {
  const path = normalizeWikiScopeId(folderPath)
  const generated = path === WIKI_ROOT_FOLDER || path.startsWith(`${WIKI_ROOT_FOLDER}/`)
  const rule = getWikiArticleRule(path, settings)
  return {
    included: !generated && Boolean(rule && rule.effect !== 'exclude'),
    inheritedFrom: rule && (rule.kind === 'source-type' || rule.id !== path)
      ? rule.kind === 'source-type' ? '' : rule.id : null,
    hasOverrides: settings.scopes.some(scope => scope.enabled
      && (scope.kind === 'article' || scope.kind === 'article-folder') && scope.id !== path
      && (!path || scope.id.startsWith(`${path}/`))),
    generated,
  }
}

async function safeFolderPath(path: string): Promise<string> {
  const relative = path.replaceAll('\\', '/')
  if (relative.startsWith('/') || /^[a-z]:/i.test(relative) || relative.includes('\0')) throw new Error('WIKI_INVALID_PATH')
  const parts = relative.split('/').filter(part => part && part !== '.')
  if (parts.some(part => part.startsWith('.'))) throw new Error('WIKI_INVALID_PATH')
  const safe = parts.join('/')
  const normalized = normalizeWikiScopeId(safe)
  if (normalized === WIKI_ROOT_FOLDER || normalized.startsWith(`${WIKI_ROOT_FOLDER}/`)) throw new Error('WIKI_GENERATED_SOURCE')
  return safe
}

async function assertFolderContextCurrent(contextId: string, isCurrent: () => boolean) {
  if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  await assertWikiContextCurrent(contextId)
  if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
}

/** Configure this folder and descendants without starting a first compilation. */
export async function setWikiFolderEnabled(folderPath: string, included: boolean, expectedContextId?: string): Promise<void> {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await getWikiContext()
  if (expectedContextId && context.id !== expectedContextId) throw new Error('WIKI_CONTEXT_CHANGED')
  await assertFolderContextCurrent(context.id, isCurrent)
  const path = await safeFolderPath(folderPath)
  await assertFolderContextCurrent(context.id, isCurrent)
  await setWikiFolderScope(path, included, context.id)
}

/** Start shared maintenance and explicitly enqueue this folder's local changes. */
export async function startWikiFolderCompilation(folderPath: string, expectedContextId?: string): Promise<void> {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await getWikiContext()
  if (expectedContextId && context.id !== expectedContextId) throw new Error('WIKI_CONTEXT_CHANGED')
  await assertFolderContextCurrent(context.id, isCurrent)
  const path = await safeFolderPath(folderPath)
  await assertFolderContextCurrent(context.id, isCurrent)
  let settings = await getWikiSettings(context.id)
  if (!settings.enabled) throw new Error('WIKI_DISABLED')
  if (!getWikiFolderSelection(path, settings).included) {
    await setWikiFolderScope(path, true, context.id)
    settings = await getWikiSettings(context.id)
  }
  await assertFolderContextCurrent(context.id, isCurrent)
  await updateWikiSettings({ started: true, paused: false, language: settings.language }, context.id)
  const { ensureWikiIndexFile } = await import('./files')
  await assertFolderContextCurrent(context.id, isCurrent)
  await ensureWikiIndexFile(context.id)
  const { enqueueWikiSource, resumeWikiQueue } = await import('./queue')
  for (const file of await collectMarkdownFiles(path)) {
    await assertFolderContextCurrent(context.id, isCurrent)
    const current = await getWikiSettings(context.id)
    if (!current.enabled) throw new Error('WIKI_DISABLED')
    if (isWikiArticlePathSelected(file.path, current)) {
      await assertFolderContextCurrent(context.id, isCurrent)
      await enqueueWikiSource(`article:${file.path}`, { immediate: true, retry: true, expectedContextId: context.id })
    }
  }
  await assertFolderContextCurrent(context.id, isCurrent)
  await resumeWikiQueue({ expectedContextId: context.id })
}
