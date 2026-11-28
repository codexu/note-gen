import { create } from 'zustand'
import {
  getCanvasProject,
  getCanvasProjectSummaries,
  insertCanvasProject,
  permanentlyDeleteCanvasProject,
  renameCanvasProject,
  restoreCanvasProject,
  setCanvasPinnedAt,
  softDeleteCanvasProject,
  updateCanvasDocument,
  updateCanvasHistory,
  updateCanvasThumbnailPath,
} from '@/db/canvases'
import { createCanvasDocument } from '@/lib/canvas/templates'
import { CANVAS_THUMBNAIL_VERSION, generateCanvasThumbnail, removeCanvasThumbnail } from '@/lib/canvas/thumbnail'
import { purgeCanvas, uploadCanvas } from '@/lib/sync/canvas-sync'
import { enqueueAutoDataSync, isAutoDataSyncProviderConfigured } from '@/lib/sync/auto-data-sync-queue'
import type {
  CanvasDocument,
  CanvasHistoryState,
  CanvasProject,
  CanvasProjectSummary,
  CanvasProjectType,
  CanvasSelectionContext,
} from '@/types/canvas'
import useSettingStore from '@/stores/setting'

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const thumbnailTimers = new Map<string, ReturnType<typeof setTimeout>>()
const thumbnailGenerationPromises = new Map<string, Promise<void>>()
const thumbnailRepairAttempts = new Set<string>()
const historySaveChains = new Map<string, Promise<void>>()
const collaborationSyncChains = new Map<string, Promise<void>>()
const MAX_THUMBNAIL_REPAIR_ATTEMPTS = 256

function syncCanvasCollaboration(id: string, document: CanvasDocument, flush: boolean) {
  if (useSettingStore.getState().primaryBackupMethod !== 'selfHosted') return Promise.resolve()
  const previousSync = collaborationSyncChains.get(id) || Promise.resolve()
  const nextSync = previousSync
    .catch(() => undefined)
    .then(async () => {
      const { syncCanvasDocument } = await import('@/lib/self-hosted-sync/canvas-collaboration')
      await syncCanvasDocument(id, document, { flush })
    })
  collaborationSyncChains.set(id, nextSync)
  void nextSync.then(() => {
    if (collaborationSyncChains.get(id) === nextSync) collaborationSyncChains.delete(id)
  }, () => {
    if (collaborationSyncChains.get(id) === nextSync) collaborationSyncChains.delete(id)
  })
  return nextSync
}

function persistCanvasHistory(id: string, history: CanvasHistoryState) {
  const previousSave = historySaveChains.get(id) || Promise.resolve()
  const nextSave = previousSave
    .catch(() => undefined)
    .then(() => updateCanvasHistory(id, history))
  historySaveChains.set(id, nextSave)
  void nextSave.then(() => {
    if (historySaveChains.get(id) === nextSave) historySaveChains.delete(id)
  }, () => {
    if (historySaveChains.get(id) === nextSave) historySaveChains.delete(id)
  })
}

export function hasCurrentThumbnail(project: Pick<CanvasProject, 'thumbnailPath'>) {
  return Boolean(project.thumbnailPath?.endsWith(`-v${CANVAS_THUMBNAIL_VERSION}.png`))
}

function getThumbnailRepairKey(project: Pick<CanvasProject, 'id' | 'updatedAt' | 'thumbnailPath'>) {
  return `${project.id}:${project.updatedAt}:${project.thumbnailPath || 'missing'}`
}

function rememberThumbnailRepairAttempt(key: string) {
  thumbnailRepairAttempts.add(key)
  if (thumbnailRepairAttempts.size <= MAX_THUMBNAIL_REPAIR_ATTEMPTS) return
  const oldestKey = thumbnailRepairAttempts.values().next().value
  if (oldestKey) thumbnailRepairAttempts.delete(oldestKey)
}

export type CanvasDeleteResult = 'local' | 'synced' | 'queued' | 'pending'

type ListedProject = CanvasProjectSummary & Partial<Pick<CanvasProject, 'document' | 'history'>>

function isLoaded(project: ListedProject | undefined): project is CanvasProject {
  return Boolean(project?.document)
}

function summaryOf(project: ListedProject): CanvasProjectSummary {
  const summary = { ...project }
  delete summary.document
  delete summary.history
  return summary
}

let listRequest = 0
let activation = 0
const mountedEditors = new Map<string, number>()
const projectSaves = new Map<string, Promise<void>>()
const projectReads = new Map<string, Promise<CanvasProject | null>>()

async function queueDocumentWrite(id: string, write: () => Promise<void>) {
  const previous = projectSaves.get(id)
  const pending = previous ? previous.catch(() => undefined).then(write) : write()
  projectSaves.set(id, pending)
  try {
    await pending
  } finally {
    if (projectSaves.get(id) === pending) projectSaves.delete(id)
  }
}

interface CanvasState {
  projects: ListedProject[]
  deletedProjects: CanvasProjectSummary[]
  documents: Record<string, CanvasDocument>
  activeCanvasId: string | null
  selectionContext: CanvasSelectionContext | null
  pendingFocus: { canvasId: string; nodeIds: string[] } | null
  loading: boolean
  trashMode: boolean
  loadProjects: () => Promise<void>
  createProject: (canvasType?: CanvasProjectType, title?: string) => Promise<CanvasProject | null>
  createProjectFromDocument: (document: CanvasDocument, title: string, canvasType?: CanvasProjectType) => Promise<CanvasProject | null>
  duplicateProject: (id: string, title?: string) => Promise<CanvasProject | null>
  retainEditor: (id: string) => () => Promise<void>
  loadProject: (id: string) => Promise<CanvasProject | null>
  openProject: (id: string) => Promise<CanvasProject | null>
  setActiveCanvasId: (id: string | null) => void
  setSelectionContext: (context: CanvasSelectionContext | null) => void
  setPendingFocus: (focus: { canvasId: string; nodeIds: string[] } | null) => void
  updateDocument: (id: string, document: CanvasDocument) => void
  applyRemoteDocument: (id: string, document: CanvasDocument) => Promise<void>
  updateHistory: (id: string, history: CanvasHistoryState) => void
  saveProject: (id: string) => Promise<void>
  refreshThumbnail: (id: string) => Promise<void>
  repairThumbnail: (id: string) => Promise<void>
  refreshAllThumbnails: () => Promise<void>
  setTrashMode: (open: boolean) => void
  togglePin: (id: string) => Promise<void>
  renameProject: (id: string, title: string) => Promise<void>
  deleteProject: (id: string, syncConfigured?: boolean) => Promise<CanvasDeleteResult>
  permanentlyDeleteProject: (id: string, syncConfigured?: boolean) => Promise<boolean>
  restoreProject: (id: string) => Promise<CanvasProject | null>
}

const useCanvasStore = create<CanvasState>((set, get) => ({
  projects: [],
  deletedProjects: [],
  documents: {},
  activeCanvasId: null,
  selectionContext: null,
  pendingFocus: null,
  loading: false,
  trashMode: false,

  loadProjects: async () => {
    const request = ++listRequest
    set({ loading: true })
    try {
      while (request === listRequest) {
        const before = get()
        const summaries = await getCanvasProjectSummaries({ includeDeleted: true })
        const active = summaries.filter(project => !project.deletedAt)
        const loaded = new Map(before.projects.filter(isLoaded).map(project => [project.id, project]))
        const refreshed = new Map<string, CanvasProject>()
        for (const summary of active) {
          if (!loaded.has(summary.id)) continue
          const project = await getCanvasProject(summary.id)
          if (project && !project.deletedAt) refreshed.set(project.id, project)
        }
        if (request !== listRequest) return
        const current = get()
        if (current.projects !== before.projects || current.deletedProjects !== before.deletedProjects) continue
        const documents: Record<string, CanvasDocument> = {}
        for (const [id, fresh] of refreshed) {
          const draft = current.documents[id]
          documents[id] = draft && draft !== loaded.get(id)?.document ? draft : fresh.document
        }
        set({
          projects: active.map(summary => refreshed.get(summary.id) ?? summary),
          deletedProjects: summaries.filter(project => project.deletedAt),
          activeCanvasId: active.some(p => p.id === current.activeCanvasId) ? current.activeCanvasId : null,
          selectionContext: active.some(p => p.id === current.selectionContext?.canvasId) ? current.selectionContext : null,
          documents,
        })
        return
      }
    } finally {
      if (request === listRequest) set({ loading: false })
    }
  },

  createProject: async (canvasType = 'blank', title = '未命名画布') => {
    const id = crypto.randomUUID()
    const project = await insertCanvasProject({
      id,
      title,
      canvasType,
      document: createCanvasDocument(canvasType),
    })
    if (!project) return null
    set(state => ({
      projects: [project, ...state.projects.filter(item => item.id !== project.id)],
      documents: { ...state.documents, [project.id]: project.document },
      activeCanvasId: project.id,
      selectionContext: null,
    }))
    void get().refreshThumbnail(project.id)
    return project
  },

  createProjectFromDocument: async (document, title, canvasType = 'blank') => {
    const project = await insertCanvasProject({
      id: crypto.randomUUID(),
      title: title.trim() || '未命名画布',
      canvasType,
      document: structuredClone(document),
    })
    if (!project) return null
    set(state => ({
      projects: [project, ...state.projects.filter(item => item.id !== project.id)],
      documents: { ...state.documents, [project.id]: project.document },
      activeCanvasId: project.id,
      selectionContext: null,
    }))
    void get().refreshThumbnail(project.id)
    return project
  },

  duplicateProject: async (id, title) => {
    const cached = get().projects.find(project => project.id === id)
    const source = isLoaded(cached) ? cached : await getCanvasProject(id, { includeHistory: false })
    if (!source || source.deletedAt) return null
    const project = await insertCanvasProject({
      id: crypto.randomUUID(),
      title: title?.trim() || `${source.title} copy`,
      canvasType: source.canvasType,
      document: structuredClone(get().documents[id] || source.document),
    })
    if (!project) return null
    set(state => ({
      projects: [project, ...state.projects.filter(item => item.id !== project.id)],
      documents: { ...state.documents, [project.id]: project.document },
      activeCanvasId: project.id,
      selectionContext: null,
    }))
    void get().refreshThumbnail(project.id)
    return project
  },

  loadProject: async (id) => {
    const cached = get().projects.find(project => project.id === id)
    if (isLoaded(cached)) return cached
    const pending = projectReads.get(id)
    if (pending) return pending
    const read = (async () => {
      let summary = cached
      while (true) {
        const project = await getCanvasProject(id)
        const state = get()
        if (!project || project.deletedAt || state.deletedProjects.some(item => item.id === id)) return null
        const current = state.projects.find(item => item.id === id)
        if (isLoaded(current)) return current
        if (summary && !current) return null
        if (current !== summary) {
          summary = current
          continue
        }
        const hydrated = { ...project, thumbnailRevision: current?.thumbnailRevision }
        set({
          projects: current
            ? state.projects.map(item => item.id === id ? hydrated : item)
            : [hydrated, ...state.projects],
          documents: { ...state.documents, [id]: state.documents[id] ?? hydrated.document },
        })
        return hydrated
      }
    })()
    projectReads.set(id, read)
    try {
      return await read
    } finally {
      if (projectReads.get(id) === read) projectReads.delete(id)
    }
  },

  retainEditor: (id) => {
    mountedEditors.set(id, (mountedEditors.get(id) ?? 0) + 1)
    return async () => {
      const count = (mountedEditors.get(id) ?? 1) - 1
      if (count) {
        mountedEditors.set(id, count)
        return
      }
      mountedEditors.delete(id)
      await projectReads.get(id)
      const draft = get().documents[id]
      if (!draft || mountedEditors.has(id)) return
      await get().saveProject(id)
      await historySaveChains.get(id)
      if (mountedEditors.has(id) || get().documents[id] !== draft) return
      set(state => {
        const documents = { ...state.documents }
        delete documents[id]
        return {
          documents,
          projects: state.projects.map(project => project.id === id ? summaryOf(project) : project),
        }
      })
    }
  },

  openProject: async (id) => {
    const request = ++activation
    const project = await get().loadProject(id)
    if (project && request === activation) get().setActiveCanvasId(id)
    return project
  },

  setActiveCanvasId: (id) => {
    ++activation
    set(state => ({
      activeCanvasId: id,
      selectionContext: state.selectionContext?.canvasId === id ? state.selectionContext : null,
    }))
  },
  setSelectionContext: (selectionContext) => set({ selectionContext }),
  setPendingFocus: (pendingFocus) => set({ pendingFocus }),

  updateDocument: (id, document) => {
    set(state => ({ documents: { ...state.documents, [id]: document } }))
    void syncCanvasCollaboration(id, document, false).catch(error => {
      console.warn('[self-hosted-sync] Unable to queue canvas update', { canvasId: id, error })
    })
    const previousTimer = saveTimers.get(id)
    if (previousTimer) clearTimeout(previousTimer)
    saveTimers.set(id, setTimeout(() => {
      saveTimers.delete(id)
      void get().saveProject(id)
    }, 1000))
  },

  applyRemoteDocument: async (id, document) => {
    // Remote materialization must not become another local CRDT edit or
    // schedule a full snapshot upload back to the sender.
    const timer = saveTimers.get(id)
    if (timer) clearTimeout(timer)
    saveTimers.delete(id)
    if (get().documents[id]) {
      set(state => ({ documents: { ...state.documents, [id]: document } }))
    }
    await queueDocumentWrite(id, async () => {
      const updatedAt = await updateCanvasDocument(id, document, { enqueueSync: false })
      set(state => {
        const project = state.projects.find(item => item.id === id)
        // An editor may have opened with the previous saved version while the write was in flight.
        const needsRemoteDocument = project?.document && state.documents[id] === project.document
        return {
          documents: needsRemoteDocument ? { ...state.documents, [id]: document } : state.documents,
          projects: state.projects.map(item => item.id === id
            ? { ...item, ...(item.document ? { document } : {}), updatedAt } : item),
        }
      })
    })
  },

  updateHistory: (id, history) => {
    const nextHistory = structuredClone(history)
    set(state => ({
      projects: state.projects.map(project => (
        project.id === id ? { ...project, history: nextHistory } : project
      )),
    }))
    persistCanvasHistory(id, nextHistory)
  },

  saveProject: async (id) => {
    await queueDocumentWrite(id, async () => {
      const document = get().documents[id]
      if (!document) return
      const cachedProject = get().projects.find(project => project.id === id)
      const hasDocumentChanges = cachedProject?.document !== document
        && JSON.stringify(cachedProject?.document) !== JSON.stringify(document)
      if (!hasDocumentChanges) {
        await syncCanvasCollaboration(id, document, true)
        if (!cachedProject?.thumbnailPath) void get().refreshThumbnail(id)
        return
      }
      const updatedAt = await updateCanvasDocument(id, document)
      set(state => ({
        projects: state.projects
          .map(project => project.id === id ? { ...project, document, updatedAt } : project)
          .sort((left, right) => right.updatedAt - left.updatedAt),
      }))
      const previousThumbnailTimer = thumbnailTimers.get(id)
      if (previousThumbnailTimer) clearTimeout(previousThumbnailTimer)
      thumbnailTimers.set(id, setTimeout(() => {
        thumbnailTimers.delete(id)
        void get().refreshThumbnail(id)
      }, 1500))
      await syncCanvasCollaboration(id, document, true)
    })
  },

  refreshThumbnail: async (id) => {
    const pendingGeneration = thumbnailGenerationPromises.get(id)
    if (pendingGeneration) return pendingGeneration
    const project = get().projects.find(item => item.id === id)
      || get().deletedProjects.find(item => item.id === id)
    if (!project) return
    const generation = (async () => {
      try {
        const document = get().documents[id] ?? (await getCanvasProject(id, { includeHistory: false }))?.document
        if (!document) return
        const thumbnailPath = await generateCanvasThumbnail(id, document)
        await updateCanvasThumbnailPath(id, thumbnailPath)
        set(state => ({
          projects: state.projects.map(project => project.id === id
            ? { ...project, thumbnailPath, thumbnailRevision: Date.now() }
            : project),
          deletedProjects: state.deletedProjects.map(project => project.id === id
            ? { ...project, thumbnailPath, thumbnailRevision: Date.now() }
            : project),
        }))
      } catch (error) {
        console.error('Failed to generate canvas thumbnail:', error)
      }
    })()
    thumbnailGenerationPromises.set(id, generation)
    try {
      await generation
    } finally {
      if (thumbnailGenerationPromises.get(id) === generation) {
        thumbnailGenerationPromises.delete(id)
      }
    }
  },

  repairThumbnail: async (id) => {
    const project = get().projects.find(item => item.id === id)
      || get().deletedProjects.find(item => item.id === id)
    if (!project) return
    const repairKey = getThumbnailRepairKey(project)
    if (thumbnailRepairAttempts.has(repairKey)) return thumbnailGenerationPromises.get(id)
    rememberThumbnailRepairAttempt(repairKey)
    await get().refreshThumbnail(id)
  },

  refreshAllThumbnails: async () => {
    for (const project of get().projects) {
      await get().refreshThumbnail(project.id)
    }
  },

  setTrashMode: (trashMode) => set({ trashMode }),

  togglePin: async (id) => {
    const project = get().projects.find(item => item.id === id)
    if (!project) return
    const pinnedAt = project.pinnedAt ? null : Date.now()
    const updatedAt = await setCanvasPinnedAt(id, pinnedAt)
    set(state => ({
      projects: state.projects.map(item => item.id === id ? { ...item, pinnedAt, updatedAt } : item),
    }))
    if (useSettingStore.getState().primaryBackupMethod === 'selfHosted') {
      const { enqueueCanvasSnapshot } = await import('@/lib/self-hosted-sync/outbox')
      await enqueueCanvasSnapshot(id)
      enqueueAutoDataSync('records', 'canvas-pinned')
    }
  },

  renameProject: async (id, title) => {
    const normalized = title.trim()
    if (!normalized) return
    const updatedAt = await renameCanvasProject(id, normalized)
    set(state => ({
      projects: state.projects.map(project => (
        project.id === id ? { ...project, title: normalized, updatedAt } : project
      )),
    }))
    if (useSettingStore.getState().primaryBackupMethod === 'selfHosted') {
      const { enqueueCanvasSnapshot } = await import('@/lib/self-hosted-sync/outbox')
      await enqueueCanvasSnapshot(id)
      enqueueAutoDataSync('records', 'canvas-renamed')
    }
  },

  deleteProject: async (id, configured) => {
    const timer = saveTimers.get(id)
    if (timer) clearTimeout(timer)
    saveTimers.delete(id)
    const thumbnailTimer = thumbnailTimers.get(id)
    if (thumbnailTimer) clearTimeout(thumbnailTimer)
    thumbnailTimers.delete(id)
    for (const key of thumbnailRepairAttempts) {
      if (key.startsWith(`${id}:`)) thumbnailRepairAttempts.delete(key)
    }
    const selfHosted = useSettingStore.getState().primaryBackupMethod === 'selfHosted'
    await get().saveProject(id)
    if (selfHosted) {
      const { closeCanvasCollaboration } = await import('@/lib/self-hosted-sync/canvas-collaboration')
      await closeCanvasCollaboration(id)
    }
    const deletedAt = await softDeleteCanvasProject(id, { enqueueSync: false })
    if (selfHosted) {
      const { enqueueCanvasSnapshot } = await import('@/lib/self-hosted-sync/outbox')
      await enqueueCanvasSnapshot(id, 'delete')
      const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
      void getSelfHostedSyncRuntime().wake('canvas-deleted')
    }
    const syncConfigured = selfHosted || (configured ?? await isAutoDataSyncProviderConfigured())
    let synced = false
    if (syncConfigured && !selfHosted) {
      try {
        synced = await uploadCanvas(id)
      } catch {
        synced = false
      }
      if (!synced) enqueueAutoDataSync('records', 'canvas-deleted')
    }
    set(state => {
      const deletedProject = state.projects.find(project => project.id === id)
      const documents = { ...state.documents }
      delete documents[id]
      return {
        projects: state.projects.filter(project => project.id !== id),
        deletedProjects: deletedProject
          ? [{ ...summaryOf(deletedProject), deletedAt, updatedAt: deletedAt }, ...state.deletedProjects.filter(item => item.id !== id)]
          : state.deletedProjects,
        documents,
        activeCanvasId: state.activeCanvasId === id ? null : state.activeCanvasId,
        selectionContext: state.selectionContext?.canvasId === id ? null : state.selectionContext,
      }
    })
    if (!syncConfigured) return 'local'
    if (selfHosted) return 'queued'
    return synced ? 'synced' : 'pending'
  },

  permanentlyDeleteProject: async (id, configured) => {
    const project = get().deletedProjects.find(item => item.id === id)
    if (!project) return false
    const syncConfigured = configured ?? await isAutoDataSyncProviderConfigured()
    if (syncConfigured && !await purgeCanvas(id)) return false
    await permanentlyDeleteCanvasProject(id)
    try {
      await removeCanvasThumbnail(project.thumbnailPath)
    } catch (error) {
      console.error('Failed to remove canvas thumbnail:', error)
    }
    set(state => ({
      deletedProjects: state.deletedProjects.filter(item => item.id !== id),
    }))
    return true
  },

  restoreProject: async (id) => {
    const project = await restoreCanvasProject(id)
    if (!project) return null
    set(state => ({
      projects: [project, ...state.projects.filter(item => item.id !== project.id)],
      deletedProjects: state.deletedProjects.filter(item => item.id !== id),
      documents: { ...state.documents, [id]: project.document },
    }))
    if (!hasCurrentThumbnail(project)) void get().refreshThumbnail(id)
    if (useSettingStore.getState().primaryBackupMethod === 'selfHosted') {
      const { enqueueCanvasSnapshot } = await import('@/lib/self-hosted-sync/outbox')
      await enqueueCanvasSnapshot(id)
      enqueueAutoDataSync('records', 'canvas-restored')
    }
    return project
  },
}))

export default useCanvasStore
