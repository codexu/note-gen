// Fork（almanac ALMNC-14）：對話頁的「專案分組」。純函式 + 存 store.json 的對照表，不改資料表。
// 對話（conversations 表）沒有可用的專案欄位，所以用 store.json 的 threadProjects：{ 對話 syncId: 專案名 }。
// 用 syncId 當 key，因為它跨裝置同步後不變（id 是本機自增）；沒有 syncId 的舊資料退回 `id:<id>`。
// 沒有對照的對話屬於「未分組」（專案名為空字串）。
import type { Conversation } from '@/db/conversations'

export const THREAD_PROJECTS_KEY = 'threadProjects'
export const MAX_PROJECT_NAME = 40

/** 對話 → 專案名。專案名一律是 normalizeProjectName 之後的非空字串。 */
export type ThreadProjectMap = Record<string, string>

export type ThreadConversation = Pick<Conversation, 'id' | 'syncId' | 'title' | 'updatedAt' | 'messageCount' | 'isPinned'>

export function threadKey(conversation: Pick<Conversation, 'id' | 'syncId'>): string {
  return conversation.syncId ? conversation.syncId : `id:${conversation.id}`
}

/** 去頭尾空白、連續空白收成一格、截到上限；全空回傳空字串。 */
export function normalizeProjectName(name: string): string {
  return Array.from(name.replace(/\s+/g, ' ').trim()).slice(0, MAX_PROJECT_NAME).join('').trim()
}

export function projectOf(map: ThreadProjectMap, conversation: Pick<Conversation, 'id' | 'syncId'>): string {
  return map[threadKey(conversation)] ?? ''
}

/** 把對話放進專案；專案名為空就是移出專案。回傳新物件，不改原本的。 */
export function assignProject(map: ThreadProjectMap, key: string, project: string): ThreadProjectMap {
  const name = normalizeProjectName(project)
  const next = { ...map }
  if (name) next[key] = name
  else delete next[key]
  return next
}

/** 專案改名；改成已存在的名字就是合併。 */
export function renameProject(map: ThreadProjectMap, from: string, to: string): ThreadProjectMap {
  const name = normalizeProjectName(to)
  if (!name) return map
  const next: ThreadProjectMap = {}
  for (const [key, value] of Object.entries(map)) next[key] = value === from ? name : value
  return next
}

/** 刪除專案：裡面的對話回到未分組，對話本身不動。 */
export function dropProject(map: ThreadProjectMap, project: string): ThreadProjectMap {
  const next: ThreadProjectMap = {}
  for (const [key, value] of Object.entries(map)) if (value !== project) next[key] = value
  return next
}

/** 讀回 store.json 的值：型別不對的丟掉，專案名重新整理。 */
export function sanitizeProjectMap(value: unknown): ThreadProjectMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: ThreadProjectMap = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string') continue
    const name = normalizeProjectName(raw)
    if (name) next[key] = name
  }
  return next
}

export function sortThreads<T extends ThreadConversation>(threads: T[]): T[] {
  return [...threads].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt)
}

export interface ThreadGroup<T extends ThreadConversation = ThreadConversation> {
  /** 空字串＝未分組。 */
  project: string
  threads: T[]
}

export type ThreadGroupMode = 'project' | 'recent'

export interface GroupOptions {
  mode: ThreadGroupMode
  query?: string
  /** 目前打開的對話：就算還沒有訊息也要列出來。 */
  keepId?: number | null
}

/**
 * 對話串列表：先濾掉空對話與不符搜尋的，再依模式分組。
 * project：每個專案一組，組依最新動態排序，未分組放最後；recent：單一組、純依時間。
 */
export function groupThreads<T extends ThreadConversation>(
  conversations: T[],
  map: ThreadProjectMap,
  { mode, query = '', keepId = null }: GroupOptions,
): ThreadGroup<T>[] {
  const needle = query.trim().toLowerCase()
  const visible = conversations.filter(conversation => {
    if (conversation.messageCount <= 0 && conversation.id !== keepId) return false
    if (!needle) return true
    return conversation.title.toLowerCase().includes(needle) || projectOf(map, conversation).toLowerCase().includes(needle)
  })
  if (visible.length === 0) return []
  if (mode === 'recent') return [{ project: '', threads: sortThreads(visible) }]

  const byProject = new Map<string, T[]>()
  for (const conversation of visible) {
    const project = projectOf(map, conversation)
    byProject.set(project, [...(byProject.get(project) ?? []), conversation])
  }
  const groups = [...byProject.entries()].map(([project, threads]) => ({ project, threads: sortThreads(threads) }))
  const newest = (group: ThreadGroup<T>) => Math.max(...group.threads.map(thread => thread.updatedAt))
  return groups.sort((a, b) => {
    if (!a.project !== !b.project) return a.project ? -1 : 1
    return newest(b) - newest(a)
  })
}

/** 目前有哪些專案（供「移到專案」選單），依最新動態排序。 */
export function listProjects(conversations: ThreadConversation[], map: ThreadProjectMap): string[] {
  const latest = new Map<string, number>()
  for (const conversation of conversations) {
    const project = projectOf(map, conversation)
    if (project) latest.set(project, Math.max(latest.get(project) ?? 0, conversation.updatedAt))
  }
  // 專案裡的對話都被刪掉時，對照表可能還留著名字；補進來避免選單少一個
  for (const project of Object.values(map)) if (!latest.has(project)) latest.set(project, 0)
  return [...latest.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([project]) => project)
}

interface ProjectStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<ProjectStorage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

export async function loadProjectMap(storage?: ProjectStorage): Promise<ThreadProjectMap> {
  try {
    const store = storage ?? await defaultStorage()
    return sanitizeProjectMap(await store.get(THREAD_PROJECTS_KEY))
  } catch {
    return {}
  }
}

export async function saveProjectMap(map: ThreadProjectMap, storage?: ProjectStorage): Promise<boolean> {
  try {
    const store = storage ?? await defaultStorage()
    await store.set(THREAD_PROJECTS_KEY, map)
    await store.save()
    return true
  } catch {
    return false
  }
}
