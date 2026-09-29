import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { checkIsTauri } from '@/lib/check'

export interface BrowserEntry {
  url: string
  title: string
  timestamp: number
}

export type BrowserSearchEngine = 'bing' | 'google' | 'baidu' | 'duckduckgo'

interface BrowserLibraryState {
  loaded: boolean
  history: BrowserEntry[]
  bookmarks: BrowserEntry[]
  searchEngine: BrowserSearchEngine
  load: () => Promise<void>
  recordVisit: (url: string, title: string) => Promise<void>
  toggleBookmark: (url: string, title: string) => Promise<void>
  removeHistory: (url: string) => Promise<void>
  clearHistory: () => Promise<void>
  setSearchEngine: (engine: BrowserSearchEngine) => Promise<void>
}

const STORE_FILE = 'browser.json'
const HISTORY_LIMIT = 200
const SEARCH_ENGINES: BrowserSearchEngine[] = ['bing', 'google', 'baidu', 'duckduckgo']
let storePromise: Promise<Store> | null = null
let loadPromise: Promise<void> | null = null
let saveQueue: Promise<void> = Promise.resolve()

function getStore(): Promise<Store> {
  storePromise ??= Store.load(STORE_FILE, { autoSave: false }).catch(error => {
    storePromise = null
    throw error
  })
  return storePromise
}

function validEntry(value: unknown): value is BrowserEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<BrowserEntry>
  try {
    const parsed = new URL(entry.url ?? '')
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && typeof entry.title === 'string'
      && typeof entry.timestamp === 'number'
      && Number.isFinite(entry.timestamp)
  } catch {
    return false
  }
}

function save(history: BrowserEntry[], bookmarks: BrowserEntry[], searchEngine: BrowserSearchEngine): Promise<void> {
  if (!checkIsTauri()) return Promise.resolve()
  const snapshot = { history: [...history], bookmarks: [...bookmarks], searchEngine }
  const task = saveQueue.catch(() => {}).then(async () => {
    const store = await getStore()
    await store.set('history', snapshot.history)
    await store.set('bookmarks', snapshot.bookmarks)
    await store.set('searchEngine', snapshot.searchEngine)
    await store.save()
  })
  saveQueue = task
  return task
}

const useBrowserLibraryStore = create<BrowserLibraryState>((set, get) => ({
  loaded: false,
  history: [],
  bookmarks: [],
  searchEngine: 'bing',
  load: async () => {
    if (get().loaded) return
    if (!checkIsTauri()) {
      set({ loaded: true })
      return
    }
    loadPromise ??= (async () => {
      const store = await getStore()
      const [history, bookmarks, searchEngine] = await Promise.all([
        store.get<unknown>('history'),
        store.get<unknown>('bookmarks'),
        store.get<unknown>('searchEngine'),
      ])
      set({
        history: Array.isArray(history) ? history.filter(validEntry).slice(0, HISTORY_LIMIT) : [],
        bookmarks: Array.isArray(bookmarks) ? bookmarks.filter(validEntry) : [],
        searchEngine: SEARCH_ENGINES.find(engine => engine === searchEngine) ?? 'bing',
        loaded: true,
      })
    })().finally(() => { loadPromise = null })
    await loadPromise
  },
  recordVisit: async (url, title) => {
    await get().load()
    const previous = get().history
    const now = Date.now()
    if (previous[0]?.url === url && now - previous[0].timestamp < 5_000) return
    const history = [{ url, title, timestamp: now }, ...previous.filter(entry => entry.url !== url)].slice(0, HISTORY_LIMIT)
    set({ history })
    await save(history, get().bookmarks, get().searchEngine)
  },
  toggleBookmark: async (url, title) => {
    await get().load()
    const current = get()
    const bookmarks = current.bookmarks.some(entry => entry.url === url)
      ? current.bookmarks.filter(entry => entry.url !== url)
      : [{ url, title, timestamp: Date.now() }, ...current.bookmarks]
    set({ bookmarks })
    await save(current.history, bookmarks, current.searchEngine)
  },
  removeHistory: async (url) => {
    await get().load()
    const history = get().history.filter(entry => entry.url !== url)
    set({ history })
    await save(history, get().bookmarks, get().searchEngine)
  },
  clearHistory: async () => {
    await get().load()
    set({ history: [] })
    await save([], get().bookmarks, get().searchEngine)
  },
  setSearchEngine: async engine => {
    await get().load()
    set({ searchEngine: engine })
    const current = get()
    await save(current.history, current.bookmarks, engine)
  },
}))

export default useBrowserLibraryStore
