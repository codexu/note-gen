import { Store } from '@tauri-apps/plugin-store'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard, getWikiContext, getWikiDeviceId } from './context'
import { emitWikiUpdated, setWikiMeta } from '@/db/wiki'
import { WIKI_ROOT_FOLDER, type WikiScope, type WikiScopeKind, type WikiSettings, type WikiSourceReference, type WikiSharedSettings } from '@/types/wiki'
import { LANGUAGE_STORAGE_KEY } from '@/i18n/config'
import { endWikiActivity, useWikiActivityStore } from '@/stores/wiki-activity'

const SETTINGS_KEY = 'wikiSettingsByContext'
let initialization: Promise<void> | null = null
let mutationQueue: Promise<void> = Promise.resolve()

async function migrateWorkspaceModels(store: Store) {
  if (await store.get<boolean>('wikiWorkspaceModelsInitialized')) return
  const modelId = await store.get<string>('wikiModel') || null
  const contexts = await store.get<Record<string, Partial<WikiSettings>>>(SETTINGS_KEY) || {}
  if (modelId) {
    const context = await getWikiContext()
    const existing = { ...contexts, [context.id]: contexts[context.id] ?? {} }
    await store.set(SETTINGS_KEY, Object.fromEntries(Object.entries(existing).map(([id, settings]) => [id,
      settings.modelId === undefined ? { ...settings, modelId } : settings,
    ])))
  }
  await store.set('wikiWorkspaceModelsInitialized', true)
  await store.save()
}

/** Run before the legacy vector runtime starts, preserving existing users' choices. */
export function initializeWikiPreferences(): Promise<void> {
  if (!initialization) initialization = (async () => {
    const store = await Store.load('store.json')
    await migrateWorkspaceModels(store)
    if (await store.get<boolean>('wikiPreferencesInitialized')) {
      if (await store.get<boolean>('wikiSemanticSearchEnabled') === undefined) {
        await store.set('wikiSemanticSearchEnabled', !(await store.get<boolean>('wikiDefaultEnabled') ?? true))
        await store.save()
      }
      return
    }
    const legacy = Boolean(await store.get('embeddingModel'))
      || await store.get('ragAutomaticSearchEnabled') !== undefined
      || await store.get('isRagEnabled') !== undefined
      || await store.get('lastVectorProcessTime') !== undefined
    await store.set('wikiDefaultEnabled', !legacy)
    await store.set('wikiSemanticSearchEnabled', legacy)
    if (!legacy) {
      await store.set('ragGlobalSemanticSearchEnabled', false)
      await store.set('autoVectorEnabled', false)
    }
    await store.set('wikiPreferencesInitialized', true)
    await store.save()
  })().catch(error => { initialization = null; throw error })
  return initialization
}

export async function getWikiSettings(contextId?: string): Promise<WikiSettings> {
  await initializeWikiPreferences()
  const store = await Store.load('store.json')
  const id = contextId ?? (await getWikiContext()).id
  const contexts = await store.get<Record<string, Partial<WikiSettings>>>(SETTINGS_KEY) || {}
  const stored = contexts[id] || {}
  return {
    enabled: stored.enabled ?? await store.get<boolean>('wikiDefaultEnabled') ?? true,
    semanticSearchEnabled: await store.get<boolean>('wikiSemanticSearchEnabled')
      ?? await store.get<boolean>('ragGlobalSemanticSearchEnabled') ?? false,
    started: stored.started ?? false,
    paused: stored.paused ?? false,
    modelId: stored.modelId ?? null,
    language: stored.language ?? await store.get<string>(LANGUAGE_STORAGE_KEY) ?? 'zh',
    languageClock: stored.languageClock ?? {},
    generation: stored.generation ?? 0,
    scopes: stored.scopes ?? [],
  }
}

function serializeMutation(operation: () => Promise<void>) {
  const next = mutationQueue.then(operation, operation)
  mutationQueue = next.catch(() => {})
  return next
}

async function currentMutation(contextId?: string) {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await getWikiContext()
  if (!isCurrent() || (contextId !== undefined && contextId !== context.id)) throw new Error('WIKI_CONTEXT_CHANGED')
  const assertCurrent = async () => {
    if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
    await assertWikiContextCurrent(context.id)
    if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  }
  return { id: context.id, assertCurrent }
}

async function writeSettings(patch: Partial<WikiSettings>, contextId: string, sync: boolean, assertCurrent: () => Promise<void>) {
  await assertCurrent()
  const store = await Store.load('store.json')
  const contexts = await store.get<Record<string, Partial<WikiSettings>>>(SETTINGS_KEY) || {}
  if (patch.language !== undefined && patch.languageClock === undefined) {
    const device = await getWikiDeviceId()
    const clock = contexts[contextId]?.languageClock ?? {}
    patch = { ...patch, languageClock: { ...clock, [device]: (clock[device] ?? 0) + 1 } }
  }
  await assertCurrent()
  await store.set(SETTINGS_KEY, { ...contexts, [contextId]: { ...contexts[contextId], ...patch } })
  if (patch.semanticSearchEnabled !== undefined) {
    await store.set('wikiSemanticSearchEnabled', patch.semanticSearchEnabled)
    // Existing users may have independently disabled semantic search in the global search box.
    if (await store.get<boolean>('wikiDefaultEnabled')) {
      await store.set('ragGlobalSemanticSearchEnabled', patch.semanticSearchEnabled)
    }
    await store.set('autoVectorEnabled', patch.semanticSearchEnabled)
    const { default: useRagSettingsStore } = await import('@/stores/ragSettings')
    useRagSettingsStore.setState({ globalSemanticSearchEnabled:
      await store.get<boolean>('ragGlobalSemanticSearchEnabled') ?? false })
    const { default: useVectorStore } = await import('@/stores/vector')
    useVectorStore.setState({ isAutoVectorEnabled: patch.semanticSearchEnabled })
  }
  await store.save()
  if (patch.enabled === false || patch.paused === true || patch.started === false) {
    const active = useWikiActivityStore.getState().active
    if (active?.contextId === contextId) endWikiActivity(active.token)
  }
  if (sync) {
    await setWikiMeta(contextId, 'dirty', true)
    void import('./sync').then(({ notifyWikiChanged }) => notifyWikiChanged())
      .catch(error => console.error('Failed to schedule Wiki settings sync:', error))
  }
  emitWikiUpdated()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('wiki-settings-changed'))
}

export async function updateWikiSettings(patch: Partial<WikiSettings>, contextId?: string) {
  const { id, assertCurrent } = await currentMutation(contextId)
  await serializeMutation(() => writeSettings(patch, id, true, assertCurrent))
}

export function normalizeWikiScopeId(value: string) {
  // File-system names are identities: compatibility normalization (and trim)
  // would merge distinct paths such as A/ and Ａ/ or files ending in spaces.
  const path = value.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '')
  // An absolute path must never turn into a relative/root selection rule.
  return path.replace(/\/+$/g, '') || (path.startsWith('/') ? '/' : '')
}

function assertWikiScopePath(path: string, allowRoot: boolean) {
  if ((!path && !allowRoot) || path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\0')
    || (path && path.split('/').some(part => !part || part.startsWith('.')))) throw new Error('WIKI_INVALID_PATH')
}

export async function addWikiScope(
  input: { kind: WikiScopeKind; id: string; label: string; effect?: WikiScope['effect'] }, contextId?: string,
) {
  const { id, assertCurrent } = await currentMutation(contextId)
  const device = await getWikiDeviceId()
  const pathScope = input.kind === 'article' || input.kind === 'article-folder'
  let scopeId = pathScope ? normalizeWikiScopeId(input.id)
    : input.id.normalize('NFKC').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '').trim()
  if (pathScope) assertWikiScopePath(scopeId, input.kind === 'article-folder')
  if (input.kind === 'record' && /^\d+$/.test(scopeId)) {
    const { getMarkById } = await import('@/db/marks')
    const mark = await getMarkById(Number(scopeId))
    if (mark) {
      if (!mark.sourceId) {
        const { getDb } = await import('@/db')
        const database = await getDb()
        await database.execute('update marks set sourceId=$1 where id=$2 and sourceId is null', [crypto.randomUUID(), mark.id])
        const rows = await database.select<Array<{ sourceId: string }>>('select sourceId from marks where id=$1', [mark.id])
        mark.sourceId = rows[0]?.sourceId
        const { enqueueAutoDataSync } = await import('@/lib/sync/auto-data-sync-queue')
        enqueueAutoDataSync('records', 'wiki:select-record')
      }
      if (mark.sourceId) scopeId = mark.sourceId
    }
  }
  if (input.kind === 'record-tag' && /^\d+$/.test(scopeId)) {
    const { getTags } = await import('@/db/tags')
    const tags = await getTags()
    if (!(input.id === input.label && tags.some(tag => tag.name === input.id))) {
      scopeId = tags.find(tag => tag.id === Number(scopeId))?.name ?? scopeId
    }
  }
  await serializeMutation(async () => {
    await assertCurrent()
    const settings = await getWikiSettings(id)
    const key = `${input.kind}:${scopeId}`
    const previous = settings.scopes.find(scope => scope.key === key)
    const scope: WikiScope = { ...input, effect: input.effect ?? 'include', id: scopeId, key, enabled: true,
      clock: { ...previous?.clock, [device]: (previous?.clock[device] ?? 0) + 1 } }
    await writeSettings({ scopes: [...settings.scopes.filter(item => item.key !== key), scope] }, id, true, assertCurrent)
    if (input.kind === 'article' && input.effect !== 'exclude') {
      const store = await Store.load('store.json')
      const generated = await store.get<Record<string, string[]>>('wikiGeneratedNotes') || {}
      await assertCurrent()
      await store.set('wikiGeneratedNotes', { ...generated, [id]: (generated[id] || []).filter(path => path !== scopeId) })
      await store.save()
    }
  })
}

export async function removeWikiScope(key: string, contextId?: string) {
  const { id, assertCurrent } = await currentMutation(contextId)
  const device = await getWikiDeviceId()
  await serializeMutation(async () => {
    const settings = await getWikiSettings(id)
    await writeSettings({ scopes: settings.scopes.map(scope => scope.key === key
      ? { ...scope, enabled: false, clock: { ...scope.clock, [device]: (scope.clock[device] ?? 0) + 1 } }
      : scope) }, id, true, assertCurrent)
  })
}

/** A folder action applies to the whole subtree; descendants can override it afterward. */
export async function setWikiFolderScope(path: string, included: boolean, contextId?: string) {
  const { id, assertCurrent } = await currentMutation(contextId)
  const folder = normalizeWikiScopeId(path)
  assertWikiScopePath(folder, true)
  const device = await getWikiDeviceId()
  await serializeMutation(async () => {
    const settings = await getWikiSettings(id)
    const key = `article-folder:${folder}`
    const previous = settings.scopes.find(scope => scope.key === key)
    const scopes = settings.scopes.map(scope => {
      if (!scope.enabled || (scope.kind !== 'article' && scope.kind !== 'article-folder')
        || (folder && scope.id !== folder && !scope.id.startsWith(`${folder}/`))) return scope
      return { ...scope, enabled: false,
        clock: { ...scope.clock, [device]: (scope.clock[device] ?? 0) + 1 } }
    }).filter(scope => scope.key !== key)
    scopes.push({ key, kind: 'article-folder', id: folder, label: folder || '/', enabled: true,
      effect: included ? 'include' : 'exclude',
      clock: { ...previous?.clock, [device]: (previous?.clock[device] ?? 0) + 1 } })
    await writeSettings({ scopes }, id, true, assertCurrent)
  })
}

/** Most specific article/folder rule wins; broad source-type rules are the fallback. */
export function getWikiArticleRule(path: string, settings: WikiSettings): WikiScope | null {
  const normalized = normalizeWikiScopeId(path)
  let selected: WikiScope | null = null
  let specificity = -2
  for (const scope of settings.scopes) {
    if (!scope.enabled) continue
    let rank = -2
    if (scope.kind === 'source-type' && scope.id === 'article') rank = -1
    else if (scope.kind === 'article' && scope.id === normalized) rank = Number.MAX_SAFE_INTEGER
    else if (scope.kind === 'article-folder' && (!scope.id || scope.id === normalized || normalized.startsWith(`${scope.id}/`))) rank = scope.id.length
    if (rank > specificity || (rank === specificity && rank > -2 && scope.effect === 'exclude')) {
      selected = scope
      specificity = rank
    }
  }
  return selected
}

/** Selection is independent of the global feature switch, for folder controls. */
export function isWikiArticlePathSelected(path: string, settings: WikiSettings): boolean {
  const normalized = normalizeWikiScopeId(path)
  if (normalized === WIKI_ROOT_FOLDER || normalized.startsWith(`${WIKI_ROOT_FOLDER}/`)) return false
  const rule = getWikiArticleRule(normalized, settings)
  return Boolean(rule && rule.effect !== 'exclude')
}

export function isWikiSourceSelected(source: WikiSourceReference, settings: WikiSettings) {
  if (!settings.enabled) return false
  const path = normalizeWikiScopeId(source.locator.filePath ?? source.sourceKey.replace(/^article:/, ''))
  if (source.sourceType === 'article') return isWikiArticlePathSelected(path, settings)
  return settings.scopes.some(scope => {
    if (!scope.enabled || scope.effect === 'exclude') return false
    if (scope.kind === 'source-type') return scope.id === source.sourceType
    if (scope.kind === 'record') return source.sourceType === 'record'
      && (scope.id === source.stableId || source.stableId === `record:${scope.id}`)
    if (scope.kind === 'record-tag') return source.sourceType === 'record'
      && Boolean(source.tagKeys?.some(key => key === scope.id || key.startsWith(`${scope.id}/`)))
    return scope.kind === 'canvas' && source.sourceType === 'canvas'
      && (scope.id === source.stableId || source.stableId === `canvas:${scope.id}`)
  })
}

function dominates(left: WikiScope, right: WikiScope) {
  const devices = new Set([...Object.keys(left.clock), ...Object.keys(right.clock)])
  return [...devices].every(device => (left.clock[device] ?? 0) >= (right.clock[device] ?? 0))
    && [...devices].some(device => (left.clock[device] ?? 0) > (right.clock[device] ?? 0))
}

export function mergeWikiScopes(local: WikiScope[], remote: WikiScope[]): WikiScope[] {
  const merged = new Map(local.map(scope => [scope.key, scope]))
  for (const incoming of remote) {
    const previous = merged.get(incoming.key)
    if (!previous) { merged.set(incoming.key, incoming); continue }
    if (dominates(previous, incoming)) continue
    if (dominates(incoming, previous)) { merged.set(incoming.key, incoming); continue }
    const clock = Object.fromEntries([...new Set([...Object.keys(previous.clock), ...Object.keys(incoming.clock)])]
      .map(device => [device, Math.max(previous.clock[device] ?? 0, incoming.clock[device] ?? 0)]))
    merged.set(incoming.key, { ...previous, enabled: previous.enabled && incoming.enabled,
      effect: previous.effect === 'exclude' || incoming.effect === 'exclude' ? 'exclude' : 'include', clock })
  }
  return [...merged.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
}

export async function mergeWikiSyncedSettings(contextId: string, incoming: WikiSharedSettings) {
  const { assertCurrent } = await currentMutation(contextId)
  await serializeMutation(async () => {
    const local = await getWikiSettings(contextId)
    const scopes = mergeWikiScopes(local.scopes, incoming.scopes)
    const remoteClock = incoming.languageClock ?? {}
    const devices = [...new Set([...Object.keys(local.languageClock), ...Object.keys(remoteClock)])]
    const remoteDominates = devices.every(device => (remoteClock[device] ?? 0) >= (local.languageClock[device] ?? 0))
      && devices.some(device => (remoteClock[device] ?? 0) > (local.languageClock[device] ?? 0))
    const localDominates = devices.every(device => (local.languageClock[device] ?? 0) >= (remoteClock[device] ?? 0))
      && devices.some(device => (local.languageClock[device] ?? 0) > (remoteClock[device] ?? 0))
    const languageClock = Object.fromEntries(devices.map(device => [device, Math.max(local.languageClock[device] ?? 0, remoteClock[device] ?? 0)]))
    const language = remoteDominates ? incoming.language : localDominates ? local.language
      : !local.started ? incoming.language : [local.language, incoming.language].sort()[0]
    const next = { scopes, generation: Math.max(local.generation, incoming.generation),
      started: local.started || incoming.started,
      enabled: local.enabled,
      language, languageClock }
    if (JSON.stringify(next) !== JSON.stringify({ scopes: local.scopes, generation: local.generation,
      started: local.started, enabled: local.enabled, language: local.language, languageClock: local.languageClock })) {
      await writeSettings(next, contextId, false, assertCurrent)
    }
  })
}

export async function getWikiGeneratedNotes(contextId?: string): Promise<string[]> {
  const id = contextId ?? (await getWikiContext()).id
  const store = await Store.load('store.json')
  return (await store.get<Record<string, string[]>>('wikiGeneratedNotes'))?.[id] ?? []
}

export async function excludeWikiGeneratedNote(path: string, contextId?: string) {
  const { id, assertCurrent } = await currentMutation(contextId)
  await serializeMutation(async () => {
    const store = await Store.load('store.json')
    const notes = await store.get<Record<string, string[]>>('wikiGeneratedNotes') || {}
    await assertCurrent()
    await store.set('wikiGeneratedNotes', { ...notes, [id]: [...new Set([...(notes[id] || []), normalizeWikiScopeId(path)])] })
    await store.save()
  })
}
