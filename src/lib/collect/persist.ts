// Fork（almanac ALMNC-10）：收集項目與提案的保存。
// 保存的是「收集」這個來源自己的狀態（還沒收下的提案關頁、重開後還在），等你定只讀它、不複製。
// 放在 store.json 的 collectItems：資料小、和其他 fork 設定（新介面開關、首頁卡片）同一處、Tauri 已有權限，
// 不需要另開資料表或新增檔案位置。
import { toDateKey } from '@/lib/daily/format'
import { isSlotTarget } from '@/lib/timeslots/model'
import type { CollectInput, Proposal, SplitSource } from './types'

export const COLLECT_ITEMS_KEY = 'collectItems'
/** 全部處理完的項目保留多久（毫秒）；沒處理完的一直留著。 */
export const DECIDED_KEEP_MS = 3 * 86_400_000

type Status = 'wait' | 'ok' | 'no'

export interface PersistedProposal extends Proposal {
  status: Status
  /** 只留寫入的檔案路徑；復原資料（整份日誌前後內容）重開後不留，所以重開後不能再復原。 */
  result?: { path: string }
}

export interface PersistedItem {
  id: string
  input: CollectInput
  createdAt: number
  state: 'ready'
  source?: SplitSource
  proposals: PersistedProposal[]
  recordId?: number
}

interface ItemLike {
  id: string
  input: CollectInput
  createdAt: number
  state: 'reading' | 'ready'
  source?: SplitSource
  proposals: Array<Proposal & { status: Status, result?: { path: string } }>
  recordId?: number
}

/** 存檔前：只存拆完的項目，圖片資料網址（可能很大）不存。 */
export function serializeItems(items: readonly ItemLike[]): PersistedItem[] {
  return items.filter(item => item.state === 'ready').map(item => ({
    id: item.id,
    input: { kind: item.input.kind, text: item.input.text, name: item.input.name },
    createdAt: item.createdAt,
    state: 'ready',
    source: item.source,
    recordId: item.recordId,
    proposals: item.proposals.map(proposal => ({
      id: proposal.id, kind: proposal.kind, title: proposal.title, body: proposal.body,
      due: proposal.due, time: proposal.time, tags: [...proposal.tags],
      ...(proposal.slot ? { slot: proposal.slot } : {}),
      status: proposal.status,
      result: proposal.result ? { path: proposal.result.path } : undefined,
    })),
  }))
}

function isProposal(value: unknown): value is PersistedProposal {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return typeof p.id === 'string' && (p.kind === 'note' || p.kind === 'task' || p.kind === 'event')
    && typeof p.title === 'string' && typeof p.body === 'string' && typeof p.due === 'string' && typeof p.time === 'string'
    && (p.slot === undefined || (p.kind === 'event' && isSlotTarget(p.slot)))
    && Array.isArray(p.tags) && (p.status === 'wait' || p.status === 'ok' || p.status === 'no')
}

/** 讀檔後：丟掉壞資料與太舊且已處理完的項目。 */
export function parseItems(value: unknown, now: number): PersistedItem[] {
  if (!Array.isArray(value)) return []
  const out: PersistedItem[] = []
  const today = toDateKey(new Date(now))
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const input = item.input as Record<string, unknown> | undefined
    if (typeof item.id !== 'string' || typeof item.createdAt !== 'number' || !input || typeof input.text !== 'string') continue
    if (input.kind !== 'text' && input.kind !== 'link' && input.kind !== 'image' && input.kind !== 'file') continue
    const proposals = Array.isArray(item.proposals) ? item.proposals.filter(isProposal) : []
    const waiting = proposals.some(proposal => proposal.status === 'wait')
    if (proposals.length && proposals.every(proposal => proposal.slot && proposal.due < today)) continue
    if (!waiting && now - item.createdAt > DECIDED_KEEP_MS) continue
    out.push({
      id: item.id,
      input: { kind: input.kind, text: input.text, name: typeof input.name === 'string' ? input.name : undefined },
      createdAt: item.createdAt,
      state: 'ready',
      source: item.source === 'ai' || item.source === 'rules' ? item.source : undefined,
      recordId: typeof item.recordId === 'number' ? item.recordId : undefined,
      proposals,
    })
  }
  return out
}

/** 新舊合併：以 id 為準，記憶體裡的（本次啟動才送進來的）優先，順序是新的在前。 */
export function mergeItems<T extends { id: string, createdAt: number }>(current: readonly T[], restored: readonly T[]): T[] {
  const ids = new Set(current.map(item => item.id))
  return [...current, ...restored.filter(item => !ids.has(item.id))].sort((a, b) => b.createdAt - a.createdAt)
}

export interface CollectStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<CollectStorage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

export async function loadItems(now: number, storage?: CollectStorage): Promise<PersistedItem[]> {
  const store = storage ?? await defaultStorage()
  return parseItems(await store.get(COLLECT_ITEMS_KEY), now)
}

export async function saveItems(items: readonly ItemLike[], storage?: CollectStorage): Promise<void> {
  const store = storage ?? await defaultStorage()
  await store.set(COLLECT_ITEMS_KEY, serializeItems(items))
  await store.save()
}
