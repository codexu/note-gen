import { getKnowledgeSource, upsertKnowledgeSource } from '@/db/knowledge'
import { getKnowledgeSourceDocument } from '@/lib/knowledge-content'
import { estimateTokens } from '@/lib/ai/token-counter'
import {
  commitWikiSourceRevision, getWikiMeta, getWikiPage, getWikiRevision, getWikiSourceState, listWikiJobs, listWikiSourceStates,
  removeWikiJob, setWikiMeta, upsertWikiJob, upsertWikiPage, upsertWikiSourceState,
} from '@/db/wiki'
import type { WikiContext, WikiJob, WikiSettings, WikiSourceState, WikiSourceStatus } from '@/types/wiki'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard, getWikiContext } from './context'
import { addWikiScope, getWikiSettings, isWikiSourceSelected, normalizeWikiScopeId, removeWikiScope, updateWikiSettings } from './settings'
import {
  collectWikiSourceDocuments, ensureWikiSourceIdentity, getWikiSourceAvailability, getWikiSourceDocument, isWikiSourceDocumentAllowed,
  wikiHash, type WikiSourceDocument,
} from './sources'
import {
  buildWikiSourceInputHash, compileWikiSource, compileWikiTopic, getWikiSourceGeneration,
  invalidateWikiSourcePages, scheduleWikiTopics, WikiSourceChangedError,
  wikiSourceWithEvidence,
} from './compiler'
import { isWikiAbort, isWikiConfigurationError } from './ai'
import { beginWikiActivity, endWikiActivity, updateWikiActivityPaths } from '@/stores/wiki-activity'

const WIKI_SAVE_DELAY = 30_000
let running: Promise<void> | null = null
let mutations: Promise<void> = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | null = null
let controller: AbortController | null = null
let activeSourceKey: string | null = null
let attached = false
let stopped = false
let pausedLocally = false
let runningWorkspaceCurrent: (() => boolean) | null = null
let controlRevision = 0

function isWikiContextChanged(error: unknown) {
  return error instanceof Error && error.message === 'WIKI_CONTEXT_CHANGED'
}

function assertWorkspaceCurrent(isCurrent: () => boolean) {
  if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
}

async function operationContext(isCurrent: () => boolean, expectedContextId?: string): Promise<WikiContext> {
  assertWorkspaceCurrent(isCurrent)
  const context = expectedContextId ? await assertWikiContextCurrent(expectedContextId) : await getWikiContext()
  assertWorkspaceCurrent(isCurrent)
  return context
}

async function assertOperationCurrent(context: WikiContext, isCurrent: () => boolean) {
  await operationContext(isCurrent, context.id)
}

function foreground() { return typeof document === 'undefined' || document.visibilityState === 'visible' }

function abortActiveWikiJob() {
  endWikiActivity()
  controller?.abort()
}

function serializeMutation(operation: () => Promise<void>) {
  const next = mutations.then(operation, operation)
  mutations = next.catch(error => { if (!isWikiContextChanged(error)) console.error('Wiki source update failed:', error) })
  return next
}

function wakeWikiQueue(delay = 0) {
  if (stopped) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void drainWikiQueue().catch(error => { if (!isWikiContextChanged(error)) console.error('Wiki queue failed:', error) })
  }, Math.max(0, delay))
}

async function registerOriginalSource(sourceKey: string, context: WikiContext, isCurrent: () => boolean) {
  await assertOperationCurrent(context, isCurrent)
  const document = await getKnowledgeSourceDocument(sourceKey)
  if (!document) return
  const previous = await getKnowledgeSource(sourceKey)
  await assertOperationCurrent(context, isCurrent)
  await upsertKnowledgeSource({ ...document, indexedHash: previous?.indexedHash ?? null,
    status: previous?.status ?? 'pending', error: previous?.error ?? null })
}

async function setSourceUnavailable(context: WikiContext, state: WikiSourceState, status: WikiSourceStatus, isCurrent: () => boolean) {
  await assertOperationCurrent(context, isCurrent)
  if (state.status === status) return
  const next: WikiSourceState = { ...state, status, version: state.version + 1, updatedAt: Date.now(), error: null }
  await upsertWikiSourceState(next)
  await assertOperationCurrent(context, isCurrent)
  await invalidateWikiSourcePages(context.id, next)
  await removeWikiJob(context.id, `source:${state.stableId}`)
}

async function hasReadySourcePage(contextId: string, stableId: string, inputHash: string) {
  const page = await getWikiPage(contextId, `source:${wikiHash(stableId)}`)
  return page?.kind === 'source' && page.status === 'ready' && page.inputHash === inputHash
    && page.sourceRefs.length === 1 && page.sourceRefs[0].stableId === stableId
}

async function enqueueDocument(
  document: WikiSourceDocument, context: WikiContext, settings: WikiSettings,
  options: { immediate?: boolean; force?: boolean; retry?: boolean; reconcile?: boolean },
  isCurrent: () => boolean,
) {
  await assertOperationCurrent(context, isCurrent)
  if (!isWikiSourceSelected(document.source, settings) || !await isWikiSourceDocumentAllowed(document, context.id)) {
    const existing = await getWikiSourceState(context.id, document.source.stableId)
    if (existing) await setSourceUnavailable(context, existing, 'excluded', isCurrent)
    return
  }
  const oldStableId = document.source.stableId
  document = await ensureWikiSourceIdentity(document)
  await assertOperationCurrent(context, isCurrent)
  if (oldStableId !== document.source.stableId) {
    for (const scope of settings.scopes) {
      if (scope.enabled && scope.kind === 'record' && (scope.id === oldStableId || `record:${scope.id}` === oldStableId)) {
        await assertOperationCurrent(context, isCurrent)
        await removeWikiScope(scope.key, context.id)
        await addWikiScope({ kind: 'record', id: document.source.stableId.replace(/^record:/, ''), label: scope.label }, context.id)
      }
    }
    settings = await getWikiSettings(context.id)
  }
  const existing = await getWikiSourceState(context.id, document.source.stableId)
  // A surviving local file is not proof that a synchronized deletion was undone.
  if (options.reconcile && existing?.status === 'deleted') return
  await registerOriginalSource(document.source.sourceKey, context, isCurrent)
  if (options.force) {
    await setWikiMeta(context.id, `markdown-overwrite:source:${wikiHash(document.source.stableId)}`, true)
    const generation = await getWikiSourceGeneration(context.id, document.source.stableId, settings)
    await setWikiMeta(context.id, `source-generation:${document.source.stableId}`, generation + 1)
  }
  const generation = await getWikiSourceGeneration(context.id, document.source.stableId, settings)
  const inputHash = buildWikiSourceInputHash(document, settings, generation)
  const deletedPages = await getWikiMeta<Record<string, string>>(context.id, 'markdown-deleted') ?? {}
  const deletedSourceHash = await getWikiMeta<string>(context.id, `markdown-deleted-source:${document.source.stableId}`)
  if (!options.force && (deletedPages[`source:${wikiHash(document.source.stableId)}`] === inputHash
    || deletedSourceHash === document.source.contentHash)) return
  const previousJob = (await listWikiJobs(context.id)).find(job => job.id === `source:${document.source.stableId}`)
  await assertOperationCurrent(context, isCurrent)
  if (!options.force && !options.retry && existing?.contentHash === document.source.contentHash
    && previousJob?.inputHash === inputHash && JSON.stringify(existing.source) === JSON.stringify(document.source)) {
    if (previousJob.status === 'pending' || previousJob.status === 'running' || previousJob.status === 'failed') return
  }
  if (existing?.status === 'ready' && existing.contentHash === document.source.contentHash && existing.revisionId) {
    const revision = await getWikiRevision(context.id, existing.revisionId)
    if (!options.force && revision?.inputHash === inputHash
      && await hasReadySourcePage(context.id, document.source.stableId, inputHash)) {
      if (JSON.stringify(existing.source) !== JSON.stringify(document.source)) {
        await upsertWikiSourceState({ ...existing, source: document.source, sourceKey: document.source.sourceKey,
          version: existing.version + 1, updatedAt: Date.now() })
      }
      return
    }
  }
  const next: WikiSourceState = {
    contextId: context.id, stableId: document.source.stableId, sourceKey: document.source.sourceKey,
    sourceType: document.source.sourceType, source: document.source,
    contentHash: document.source.contentHash, status: 'pending', revisionId: existing?.revisionId ?? null,
    version: (existing?.version ?? 0) + 1, updatedAt: Date.now(), error: null,
  }
  if (activeSourceKey === document.source.sourceKey) abortActiveWikiJob()
  await upsertWikiSourceState(next)
  await assertOperationCurrent(context, isCurrent)
  if (existing?.revisionId) await invalidateWikiSourcePages(context.id, next)
  await upsertWikiJob({
    id: `source:${document.source.stableId}`, contextId: context.id, sourceKey: document.source.sourceKey,
    kind: 'source', inputHash, status: 'pending', stage: 'source', attempts: 0,
    readyAt: Date.now() + (options.immediate ? 0 : WIKI_SAVE_DELAY), updatedAt: Date.now(), error: null,
  })
}

export async function enqueueWikiSource(sourceKey: string, options: { immediate?: boolean; force?: boolean; retry?: boolean; expectedContextId?: string } = {}) {
  const isCurrent = captureWikiWorkspaceGuard()
  return serializeMutation(async () => {
    const context = await operationContext(isCurrent, options.expectedContextId)
    const settings = await getWikiSettings(context.id)
    if (!settings.enabled || !settings.started) return
    const document = await getWikiSourceDocument(sourceKey)
    await assertOperationCurrent(context, isCurrent)
    if (document) await enqueueDocument(document, context, settings, options, isCurrent)
    else {
      if (activeSourceKey === sourceKey) abortActiveWikiJob()
      const state = (await listWikiSourceStates(context.id)).find(item => item.sourceKey === sourceKey)
      if (state) {
        const availability = await getWikiSourceAvailability(sourceKey)
        await setSourceUnavailable(context, state, availability === 'deleted' ? 'deleted' : 'unavailable', isCurrent)
      }
    }
    if (isCurrent()) wakeWikiQueue(options.immediate ? 0 : WIKI_SAVE_DELAY)
  })
}

export async function reconcileWikiSources(expectedContextId?: string) {
  const isCurrent = captureWikiWorkspaceGuard()
  return serializeMutation(async () => {
    const context = await operationContext(isCurrent, expectedContextId)
    const settings = await getWikiSettings(context.id)
    if (!settings.enabled || !settings.started) return
    const documents = await collectWikiSourceDocuments()
    await assertOperationCurrent(context, isCurrent)
    const current = new Map(documents.map(document => [document.source.stableId, document]))
    for (const state of await listWikiSourceStates(context.id)) {
      await assertOperationCurrent(context, isCurrent)
      const document = current.get(state.stableId)
      if (!document) {
        if (state.sourceType === 'article') {
          if (!isWikiSourceSelected(state.source, settings)) await setSourceUnavailable(context, state, 'excluded', isCurrent)
          // Do not classify an undownloaded remote note as deleted.
          else if (!['deleted', 'excluded'].includes(state.status)) {
            const { isWikiSourceCurrent } = await import('./sync')
            if (!await isWikiSourceCurrent(state.source)) await setSourceUnavailable(context, state, 'unavailable', isCurrent)
          }
        } else {
          const availability = await getWikiSourceAvailability(state.sourceKey)
          if (availability === 'deleted') await setSourceUnavailable(context, state, 'deleted', isCurrent)
          else if (availability === 'unavailable') {
            const { isWikiSourceCurrent } = await import('./sync')
            if (!await isWikiSourceCurrent(state.source)) await setSourceUnavailable(context, state, 'unavailable', isCurrent)
          }
        }
      } else if (!isWikiSourceSelected(document.source, settings)) await setSourceUnavailable(context, state, 'excluded', isCurrent)
    }
    for (const document of documents) await enqueueDocument(document, context, settings, { immediate: true, reconcile: true }, isCurrent)
    if (isCurrent()) wakeWikiQueue()
  })
}

async function currentJob(contextId: string, job: WikiJob) {
  return (await listWikiJobs(contextId)).find(item => item.id === job.id)
}

class WikiTopicSourcesPendingError extends Error {
  constructor(readonly readyAt: number) {
    super('WIKI_TOPIC_SOURCES_PENDING')
    this.name = 'WikiTopicSourcesPendingError'
  }
}

/** A topic must not temporarily discard a source that is still being updated. */
async function topicDependencyDelays(
  contextId: string, topicKeys: Set<string>, settings: WikiSettings, jobs: WikiJob[],
): Promise<Map<string, number>> {
  const sourceJobs = jobs.filter(job => job.kind === 'source'
    && (job.status === 'pending' || job.status === 'running'))
  const delays = new Map<string, number>()
  if (!sourceJobs.length || !topicKeys.size) return delays
  const states = await listWikiSourceStates(contextId)
  const byId = new Map(states.map(state => [state.stableId, state]))
  const byKey = new Map(states.map(state => [state.sourceKey, state]))
  const pendingSources = new Map<string, number>()
  const block = (key: string, readyAt: number) => {
    if (topicKeys.has(key)) delays.set(key, Math.max(delays.get(key) ?? 0, readyAt))
  }
  for (const job of sourceJobs) {
    const state = byId.get(job.id.replace(/^source:/, '')) || byKey.get(job.sourceKey)
    if (!state || ['deleted', 'excluded', 'unavailable', 'failed'].includes(state.status)
      || !isWikiSourceSelected(state.source, settings)) continue
    const readyAt = Math.max(Date.now() + 1000, job.readyAt)
    const previous = state.revisionId ? await getWikiRevision(contextId, state.revisionId) : null
    if (state.status === 'ready' && previous?.inputHash === job.inputHash
      && previous.source.contentHash === state.contentHash) continue
    pendingSources.set(state.stableId, readyAt)
    if (previous) {
      for (const contribution of previous.contributions) block(contribution.topicKey, readyAt)
    } else {
      // A first extraction has no topic catalog yet. Wait for it rather than
      // paying to generate a partial topic and then immediately generating it again.
      for (const key of topicKeys) block(key, readyAt)
    }
  }
  if (pendingSources.size) for (const key of topicKeys) {
    if (delays.has(key)) continue
    const page = await getWikiPage(contextId, `topic:${key}`)
    if (!page || page.kind !== 'topic') continue
    for (const source of page.sourceRefs) {
      const readyAt = pendingSources.get(source.stableId)
      if (readyAt !== undefined) block(key, readyAt)
    }
  }
  return delays
}

async function assertTopicSourcesReady(context: WikiContext, topicKey: string, isCurrent: () => boolean) {
  // Enqueuing writes a source state before its job. Let that mutation finish
  // before inspecting dependencies so the brief intermediate state is not missed.
  await mutations
  await assertOperationCurrent(context, isCurrent)
  const settings = await getWikiSettings(context.id)
  if (!settings.enabled || !settings.started || settings.paused) throw new DOMException('Wiki task cancelled', 'AbortError')
  const jobs = await listWikiJobs(context.id)
  const delays = await topicDependencyDelays(context.id, new Set([topicKey]), settings, jobs)
  await assertOperationCurrent(context, isCurrent)
  const readyAt = delays.get(topicKey)
  if (readyAt !== undefined) throw new WikiTopicSourcesPendingError(readyAt)
}

async function executeWikiJob(
  job: WikiJob, context: WikiContext, settings: WikiSettings, signal: AbortSignal, activityToken: string,
  isCurrent: () => boolean,
) {
  await assertOperationCurrent(context, isCurrent)
  const { pullWikiBeforeCompilation } = await import('./sync')
  try { await pullWikiBeforeCompilation(context) } catch (error) {
    // Synchronization is an optimization here; locally available sources remain usable offline.
    console.warn('Wiki pre-compilation synchronization deferred:', error)
  }
  if (signal.aborted) throw new DOMException('Wiki task cancelled', 'AbortError')
  await assertOperationCurrent(context, isCurrent)
  settings = await getWikiSettings(context.id)
  if (job.kind === 'topic') {
    const beforeCommit = async () => {
      if (signal.aborted) throw new DOMException('Wiki task cancelled', 'AbortError')
      await assertTopicSourcesReady(context, job.sourceKey, isCurrent)
      if (signal.aborted) throw new DOMException('Wiki task cancelled', 'AbortError')
    }
    await beforeCommit()
    await compileWikiTopic(job.sourceKey, context, settings, signal, sources => {
      updateWikiActivityPaths(activityToken, sources.flatMap(source => source.sourceType === 'article'
        ? [source.locator.filePath || source.sourceKey.replace(/^article:/, '')] : []))
    }, beforeCommit)
    return
  }
  const document = await getWikiSourceDocument(job.sourceKey)
  await assertOperationCurrent(context, isCurrent)
  if (!document) throw new WikiSourceChangedError()
  updateWikiActivityPaths(activityToken, document.source.sourceType === 'article'
    ? [document.source.locator.filePath || document.source.sourceKey.replace(/^article:/, '')] : [])
  const state = await getWikiSourceState(context.id, document.source.stableId)
  if (!state || ['deleted', 'excluded', 'unavailable'].includes(state.status)) throw new WikiSourceChangedError()
  if (!isWikiSourceSelected(document.source, settings) || !await isWikiSourceDocumentAllowed(document, context.id)) throw new WikiSourceChangedError()
  const generation = await getWikiSourceGeneration(context.id, document.source.stableId, settings)
  const inputHash = buildWikiSourceInputHash(document, settings, generation)
  if (state.status === 'ready' && state.contentHash === document.source.contentHash && state.revisionId) {
    const revision = await getWikiRevision(context.id, state.revisionId)
    if (revision?.inputHash === inputHash
      && await hasReadySourcePage(context.id, document.source.stableId, inputHash)) return
  }
  const processing = { ...state, status: 'processing' as const, version: state.version + 1, updatedAt: Date.now(), error: null }
  await assertOperationCurrent(context, isCurrent)
  await upsertWikiSourceState(processing)
  await compileWikiSource(document, context, settings, processing, signal)
}

async function drainWikiQueue() {
  if (running) return running
  const isCurrent = captureWikiWorkspaceGuard()
  runningWorkspaceCurrent = isCurrent
  running = (async () => {
    while (!stopped && !pausedLocally && foreground() && isCurrent()) {
      await mutations
      if (!isCurrent()) break
      const context = await operationContext(isCurrent)
      const settings = await getWikiSettings(context.id)
      if (!settings.enabled || !settings.started || settings.paused) break
      const allJobs = await listWikiJobs(context.id)
      const jobs = allJobs.filter(job => job.status === 'pending')
      if (!isCurrent()) break
      const ready = jobs.filter(job => job.readyAt <= Date.now())
      // Ready sources run first. Topics also wait for their pending dependencies
      // whose debounce has not elapsed; unrelated topics remain free to run.
      let job = ready.find(item => item.kind === 'source')
      if (!job) {
        const topicJobs = ready.filter(item => item.kind === 'topic')
        const delays = await topicDependencyDelays(context.id, new Set(topicJobs.map(item => item.sourceKey)), settings, allJobs)
        await assertOperationCurrent(context, isCurrent)
        for (const candidate of topicJobs) {
          const readyAt = delays.get(candidate.sourceKey)
          if (readyAt === undefined) { job = candidate; break }
          const latest = await currentJob(context.id, candidate)
          await assertOperationCurrent(context, isCurrent)
          if (latest?.status !== 'pending' || latest.updatedAt !== candidate.updatedAt || latest.inputHash !== candidate.inputHash) continue
          const deferred = { ...candidate, readyAt, updatedAt: Date.now() }
          await upsertWikiJob(deferred)
          Object.assign(candidate, deferred)
        }
      }
      if (!job) {
        if (jobs.length) wakeWikiQueue(Math.max(0, Math.min(...jobs.map(item => item.readyAt)) - Date.now()))
        break
      }
      // A pause, workspace switch, or background transition may occur during
      // the asynchronous queue reads above. Do not start a stale visible job.
      await assertOperationCurrent(context, isCurrent)
      const currentSettings = await getWikiSettings(context.id)
      if (!isCurrent() || stopped || pausedLocally || !foreground() || !currentSettings.enabled
        || !currentSettings.started || currentSettings.paused) break
      const jobController = new AbortController()
      controller = jobController
      activeSourceKey = job.kind === 'source' ? job.sourceKey : null
      const startedAt = Date.now()
      let activityToken: string | undefined
      try {
        activityToken = beginWikiActivity(context, job.id,
          job.kind === 'source' && job.sourceKey.startsWith('article:') ? [job.sourceKey.slice('article:'.length)] : [])
        await upsertWikiJob({ ...job, status: 'running', updatedAt: startedAt })
        await executeWikiJob(job, context, currentSettings, jobController.signal, activityToken, isCurrent)
        await assertOperationCurrent(context, isCurrent)
        const pending = await currentJob(context.id, job)
        if (pending?.inputHash === job.inputHash && pending.updatedAt <= startedAt) await removeWikiJob(context.id, job.id)
      } catch (error) {
        if (activityToken) endWikiActivity(activityToken)
        const pending = await currentJob(context.id, job)
        if (!pending || pending.inputHash !== job.inputHash || pending.updatedAt > startedAt) continue
        if (error instanceof WikiTopicSourcesPendingError && isCurrent()) {
          await upsertWikiJob({ ...job, status: 'pending', readyAt: error.readyAt, updatedAt: Date.now(), error: null })
        } else if (!isCurrent() || isWikiContextChanged(error) || isWikiAbort(error) || error instanceof WikiSourceChangedError) {
          await upsertWikiJob({ ...job, status: 'pending', readyAt: Date.now() + 1000, updatedAt: Date.now(), error: null })
          if (isCurrent() && error instanceof WikiSourceChangedError && (await getWikiContext()).id === context.id) {
            if (job.kind === 'source') void enqueueWikiSource(job.sourceKey, { immediate: true, expectedContextId: context.id })
          }
        } else {
          const message = error instanceof Error ? error.message : String(error)
          await upsertWikiJob({ ...job, status: 'failed', attempts: job.attempts + 1, updatedAt: Date.now(), error: message })
          if (job.kind === 'source') {
            const state = (await listWikiSourceStates(context.id)).find(item => item.sourceKey === job.sourceKey)
            if (state && state.contentHash === (await getWikiSourceDocument(job.sourceKey))?.source.contentHash) {
              await upsertWikiSourceState({ ...state, status: 'failed', version: state.version + 1, updatedAt: Date.now(), error: message })
            }
          }
          if (isWikiConfigurationError(error)) { await updateWikiSettings({ paused: true }, context.id); break }
        }
      } finally {
        if (activityToken) endWikiActivity(activityToken)
        if (controller === jobController) {
          controller = null
          activeSourceKey = null
        }
      }
    }
  })().finally(() => { running = null; runningWorkspaceCurrent = null })
  return running
}

function onWikiVisibility() {
  if (!foreground()) abortActiveWikiJob()
  else void resumeWikiQueue().catch(error => { if (!isWikiContextChanged(error)) console.error('Failed to resume Wiki queue:', error) })
}

export async function resumeWikiQueue(options: { unpause?: boolean; expectedContextId?: string } = {}) {
  const isCurrent = captureWikiWorkspaceGuard()
  const revision = controlRevision
  const context = await operationContext(isCurrent, options.expectedContextId)
  // A new workspace must wait for the aborted worker to return its old job to
  // pending before resetting and waking its own queue.
  if (running && runningWorkspaceCurrent && !runningWorkspaceCurrent()) {
    await running.catch(error => { if (!isWikiContextChanged(error)) throw error })
    await assertOperationCurrent(context, isCurrent)
  }
  if (options.unpause) await updateWikiSettings({ paused: false }, context.id)
  const settings = await getWikiSettings(context.id)
  await assertOperationCurrent(context, isCurrent)
  if (!settings.enabled || !settings.started || settings.paused) {
    stopWikiQueue()
    return
  }
  if (!running) for (const job of await listWikiJobs(context.id)) {
    await assertOperationCurrent(context, isCurrent)
    if (job.status === 'running' || job.status === 'paused') {
      await upsertWikiJob({ ...job, status: 'pending', readyAt: Date.now(), updatedAt: Date.now() })
    }
  }
  await assertOperationCurrent(context, isCurrent)
  if (controlRevision !== revision) return
  stopped = false
  pausedLocally = false
  if (typeof document !== 'undefined' && !attached) {
    document.addEventListener('visibilitychange', onWikiVisibility)
    attached = true
  }
  wakeWikiQueue()
}

export function stopWikiQueue() {
  controlRevision++
  stopped = true
  abortActiveWikiJob()
  if (timer) clearTimeout(timer)
  timer = null
  if (typeof document !== 'undefined' && attached) document.removeEventListener('visibilitychange', onWikiVisibility)
  attached = false
}

export async function pauseWikiQueue(expectedContextId?: string) {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await operationContext(isCurrent, expectedContextId)
  controlRevision++
  pausedLocally = true
  abortActiveWikiJob()
  if (timer) clearTimeout(timer)
  timer = null
  await updateWikiSettings({ paused: true }, context.id)
}

export async function startWikiCompilation(expectedContextId?: string) {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await operationContext(isCurrent, expectedContextId)
  const settings = await getWikiSettings(context.id)
  await assertOperationCurrent(context, isCurrent)
  await updateWikiSettings({ enabled: true, started: true, paused: false, language: settings.language }, context.id)
  const { ensureWikiIndexFile } = await import('./files')
  await assertOperationCurrent(context, isCurrent)
  await ensureWikiIndexFile(context.id)
  await assertOperationCurrent(context, isCurrent)
  await reconcileWikiSources(context.id)
  await resumeWikiQueue({ expectedContextId: context.id })
}

export async function estimateWikiScope(expectedContextId?: string) {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await operationContext(isCurrent, expectedContextId)
  const settings = await getWikiSettings(context.id)
  const documents = (await collectWikiSourceDocuments()).filter(document => isWikiSourceSelected(document.source, settings))
  await assertOperationCurrent(context, isCurrent)
  return {
    sourceCount: documents.length,
    estimatedTokens: documents.reduce((sum, document) => sum + Math.ceil(estimateTokens(document.content) * 1.5) + 1200, 0),
  }
}

export async function retryWikiJob(id: string, options: { overwriteEdited?: boolean; expectedContextId?: string } = {}) {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await operationContext(isCurrent, options.expectedContextId)
  const job = (await listWikiJobs(context.id)).find(item => item.id === id)
  await assertOperationCurrent(context, isCurrent)
  if (!job) return
  if (job.kind === 'source') await enqueueWikiSource(job.sourceKey, {
    immediate: true, retry: true, force: options.overwriteEdited, expectedContextId: context.id,
  })
  else {
    if (options.overwriteEdited) {
      await setWikiMeta(context.id, `markdown-overwrite:${job.id}`, true)
      const page = await getWikiPage(context.id, job.id)
      const settings = await getWikiSettings(context.id)
      const generation = Math.max(settings.generation, page?.generation ?? 0,
        await getWikiMeta<number>(context.id, `topic-generation:${job.sourceKey}`) ?? 0) + 1
      await assertOperationCurrent(context, isCurrent)
      await setWikiMeta(context.id, `topic-generation:${job.sourceKey}`, generation)
    }
    await assertOperationCurrent(context, isCurrent)
    await upsertWikiJob({ ...job, status: 'pending', error: null, readyAt: Date.now(), updatedAt: Date.now() })
  }
  await assertOperationCurrent(context, isCurrent)
  await updateWikiSettings({ paused: false }, context.id)
  await resumeWikiQueue({ expectedContextId: context.id })
}

export async function rebuildWikiPage(id: string, expectedContextId?: string) {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await operationContext(isCurrent, expectedContextId)
  const page = await getWikiPage(context.id, id)
  await assertOperationCurrent(context, isCurrent)
  if (!page) return
  await setWikiMeta(context.id, `markdown-overwrite:${page.id}`, true)
  if (page.kind === 'source') {
    const source = page.sourceRefs[0]
    if (source) await enqueueWikiSource(source.sourceKey, { immediate: true, force: true, expectedContextId: context.id })
  } else {
    const key = page.topicKey || page.id.replace(/^topic:/, '')
    const settings = await getWikiSettings(context.id)
    const generation = Math.max(settings.generation, page.generation ?? 0,
      await getWikiMeta<number>(context.id, `topic-generation:${key}`) ?? 0) + 1
    await assertOperationCurrent(context, isCurrent)
    await setWikiMeta(context.id, `topic-generation:${key}`, generation)
    await upsertWikiPage({ ...page, status: 'stale' })
    await upsertWikiJob({ id: `topic:${key}`, contextId: context.id, sourceKey: key, kind: 'topic',
      inputHash: '', status: 'pending', stage: 'topic', attempts: 0, error: null, readyAt: Date.now(), updatedAt: Date.now() })
  }
  await assertOperationCurrent(context, isCurrent)
  await resumeWikiQueue({ expectedContextId: context.id })
}

export async function removeWikiSource(sourceKey: string, reason: 'deleted' | 'excluded' = 'deleted', expectedContextId?: string) {
  const isCurrent = captureWikiWorkspaceGuard()
  return serializeMutation(async () => {
    const context = await operationContext(isCurrent, expectedContextId)
    if (activeSourceKey === sourceKey) abortActiveWikiJob()
    for (const state of await listWikiSourceStates(context.id)) {
      if (state.sourceKey === sourceKey) await setSourceUnavailable(context, state, reason, isCurrent)
    }
    if (isCurrent()) wakeWikiQueue()
  })
}

export async function moveWikiArticleSources(oldPath: string, newPath: string, isFolder = false, expectedContextId?: string) {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await operationContext(isCurrent, expectedContextId)
  const normalizedOld = normalizeWikiScopeId(oldPath)
  const normalizedNew = normalizeWikiScopeId(newPath)
  if (normalizedOld === normalizedNew) return
  const previousSettings = await getWikiSettings(context.id)
  for (const scope of previousSettings.scopes) {
    await assertOperationCurrent(context, isCurrent)
    if (!scope.enabled || (scope.kind !== 'article' && scope.kind !== 'article-folder')) continue
    if (scope.id !== normalizedOld && !(isFolder && scope.id.startsWith(`${normalizedOld}/`))) continue
    const destination = `${normalizedNew}${scope.id.slice(normalizedOld.length)}`
    await removeWikiScope(scope.key, context.id)
    await addWikiScope({ kind: scope.kind, id: destination, label: destination, effect: scope.effect }, context.id)
  }
  for (const state of await listWikiSourceStates(context.id)) {
    await assertOperationCurrent(context, isCurrent)
    if (state.sourceType !== 'article' || state.status === 'deleted') continue
    const path = state.source.locator.filePath || state.sourceKey.replace(/^article:/, '')
    if (path !== normalizedOld && !(isFolder && path.startsWith(`${normalizedOld}/`))) continue
    const destination = `${normalizedNew}${path.slice(normalizedOld.length)}`
    const previous = state.revisionId ? await getWikiRevision(context.id, state.revisionId) : null
    // Keep the old portable key as a tombstone, while reusing the actual compiled content at its new path.
    await removeWikiSource(state.sourceKey, 'deleted', context.id)
    await assertOperationCurrent(context, isCurrent)
    const document = await getWikiSourceDocument(`article:${destination}`)
    const settings = await getWikiSettings(context.id)
    if (document && previous && previous.source.contentHash === document.source.contentHash
      && isWikiSourceSelected(document.source, settings) && await isWikiSourceDocumentAllowed(document, context.id)) {
      await registerOriginalSource(document.source.sourceKey, context, isCurrent)
      const current = await getWikiSourceState(context.id, document.source.stableId)
      await assertOperationCurrent(context, isCurrent)
      const next: WikiSourceState = {
        contextId: context.id, stableId: document.source.stableId, sourceKey: document.source.sourceKey,
        sourceType: 'article', source: document.source, contentHash: document.source.contentHash,
        status: 'pending', revisionId: null, version: (current?.version ?? 0) + 1, updatedAt: Date.now(), error: null,
      }
      await upsertWikiSourceState(next)
      const inputHash = buildWikiSourceInputHash(document, settings, previous.generation)
      const revision = { ...previous, id: `${inputHash}:${previous.outputHash}`, inputHash,
        source: document.source, createdAt: Date.now() }
      await commitWikiSourceRevision(revision, [{
        id: `source:${wikiHash(document.source.stableId)}`, contextId: context.id, kind: 'source',
        title: document.source.title, aliases: [], body: revision.summary,
        sourceRefs: [wikiSourceWithEvidence(document.source, revision.contributions)],
        inputHash, outputHash: revision.outputHash, generation: revision.generation,
        updatedAt: Date.now(), status: 'ready', relatedPageIds: revision.contributions.map(item => `topic:${item.topicKey}`),
      }], next.version)
      await scheduleWikiTopics(context.id, revision.contributions.map(item => item.topicKey))
    } else {
      await assertOperationCurrent(context, isCurrent)
      await enqueueWikiSource(`article:${destination}`, { immediate: true, expectedContextId: context.id })
    }
  }
  if (isCurrent()) wakeWikiQueue()
}
