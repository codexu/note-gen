// @vitest-environment jsdom
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import tw from '../../../../../messages/zh-TW.json'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/stores/article', () => ({ default: vi.fn() }))
vi.mock('@/lib/daily/note-io', () => ({ revealInFileTree: vi.fn() }))
const { graphNodeClass, graphTruncationKey } = await import('./local-graph-panel')
const node = { id: 'folder/a.md', label: 'a', path: 'folder/a.md', distance: 1, folder: 'folder' }
describe('關聯圖顯示規則', () => {
  it('六語系的 key 齊全且位於屬性之後', () => {
    for (const locale of [en, zh, tw]) {
      expect(Object.keys(locale.localGraph).sort()).toEqual(['title', 'depth1', 'depth2', 'empty', 'indexing', 'notMarkdown', 'unresolved', 'truncated'].sort())
      const keys = Object.keys(locale)
      expect(keys[keys.indexOf('properties') + 1]).toBe('localGraph')
      expect(keys[keys.indexOf('localGraph') + 1]).toBe('settings')
      expect(locale.localGraph.truncated).toContain('{count}')
    }
  })
  it('中心為反白實心，同資料夾為淡色底', () => {
    expect(graphNodeClass({ ...node, distance: 0 }, node.path)).toBe('border-invert bg-invert text-invert-ink')
    expect(graphNodeClass(node, 'folder/center.md')).toContain('bg-hover')
    expect(graphNodeClass(node, 'other/center.md')).toBe('border-border bg-background text-foreground')
  })
  it('未建立節點顯示淡色虛線', () => {
    expect(graphNodeClass({ ...node, path: null }, 'folder/center.md')).toContain('border-dashed')
    expect(graphNodeClass({ ...node, path: null }, 'folder/center.md')).toContain('text-muted-foreground')
  })
  it('僅截斷時顯示截斷訊息', () => {
    expect(graphTruncationKey(true)).toBe('truncated')
    expect(graphTruncationKey(false)).toBeNull()
  })
})
