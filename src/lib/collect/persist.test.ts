// almanac ALMNC-10：收集提案保存到 store.json，重開後還在；圖片資料與復原資料不存。
import { describe, expect, it } from 'vitest'
import { COLLECT_ITEMS_KEY, DECIDED_KEEP_MS, loadItems, mergeItems, parseItems, saveItems, serializeItems, type CollectStorage } from './persist'

const base = { body: '', due: '', time: '', tags: [] as string[] }
const NOW = Date.UTC(2026, 10, 18)

function fakeStorage(initial?: unknown): CollectStorage & { data: Map<string, unknown>, saves: number } {
  const data = new Map<string, unknown>(initial === undefined ? [] : [[COLLECT_ITEMS_KEY, initial]])
  return { data, saves: 0, get: async key => data.get(key), set: async (key, value) => { data.set(key, value) }, async save() { this.saves += 1 } }
}

const item = (over: Record<string, unknown> = {}) => ({
  id: 'c1', createdAt: NOW - 1000, state: 'ready' as const, source: 'ai' as const,
  input: { kind: 'image' as const, text: '白板', name: 'a.png', imageDataUrl: 'data:image/png;base64,AAAA' },
  proposals: [
    { ...base, id: 'p1', kind: 'task' as const, title: '甲', status: 'wait' as const },
    { ...base, id: 'p2', kind: 'event' as const, title: '乙', time: '10:00', status: 'ok' as const, result: { path: 'd.md', record: { writes: [{ path: 'd.md', before: 'x'.repeat(1000), after: 'y' }] } } },
  ],
  ...over,
})

describe('serializeItems', () => {
  it('只存拆完的項目，不存圖片資料網址與復原資料', () => {
    const out = serializeItems([item(), item({ id: 'c2', state: 'reading', proposals: [] })])
    expect(out).toHaveLength(1)
    expect(JSON.stringify(out)).not.toContain('data:image')
    expect(JSON.stringify(out)).not.toContain('xxxx')
    expect(out[0].proposals[1].result).toEqual({ path: 'd.md' })
  })
})

describe('parseItems', () => {
  it('寫了再讀回來內容一致，wait 的提案還是 wait', async () => {
    const storage = fakeStorage()
    await saveItems([item()], storage)
    expect(storage.saves).toBe(1)
    const [restored] = await loadItems(NOW, storage)
    expect(restored.proposals.map(p => p.status)).toEqual(['wait', 'ok'])
    expect(restored.input).toEqual({ kind: 'image', text: '白板', name: 'a.png' })
  })
  it('壞資料略過、不丟例外', () => {
    expect(parseItems('nope', NOW)).toEqual([])
    expect(parseItems([null, 3, { id: 'x' }, { id: 'y', createdAt: NOW, input: { kind: 'zip', text: '' } }], NOW)).toEqual([])
    const [only] = parseItems([{ ...item(), proposals: [{ id: 'bad' }, ...item().proposals] }], NOW)
    expect(only.proposals).toHaveLength(2)
  })
  it('處理完又太舊的項目丟掉，還有 wait 的一直留著', () => {
    const old = NOW - DECIDED_KEEP_MS - 1
    const decided = item({ id: 'done', createdAt: old, proposals: [{ ...base, id: 'p', kind: 'task', title: 'x', status: 'ok' }] })
    const waiting = item({ id: 'wait', createdAt: old })
    expect(parseItems([decided, waiting], NOW).map(entry => entry.id)).toEqual(['wait'])
  })
})

describe('mergeItems', () => {
  it('記憶體裡的優先，依建立時間新的在前', () => {
    const merged = mergeItems([{ id: 'a', createdAt: 5, v: 'mem' }], [{ id: 'a', createdAt: 5, v: 'disk' }, { id: 'b', createdAt: 9, v: 'disk' }])
    expect(merged).toEqual([{ id: 'b', createdAt: 9, v: 'disk' }, { id: 'a', createdAt: 5, v: 'mem' }])
  })
})
