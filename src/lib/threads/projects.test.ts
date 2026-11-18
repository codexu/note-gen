import { describe, expect, it } from 'vitest'
import {
  assignProject, dropProject, groupThreads, listProjects, loadProjectMap, normalizeProjectName, projectOf, renameProject,
  sanitizeProjectMap, saveProjectMap, threadKey, THREAD_PROJECTS_KEY, type ThreadConversation,
} from './projects'

function conv(id: number, over: Partial<ThreadConversation> = {}): ThreadConversation {
  return { id, syncId: `s${id}`, title: `對話 ${id}`, updatedAt: id * 1000, messageCount: 3, isPinned: false, ...over }
}

describe('threads/projects', () => {
  it('threadKey 用 syncId，沒有就退回 id', () => {
    expect(threadKey({ id: 1, syncId: 'abc' })).toBe('abc')
    expect(threadKey({ id: 7, syncId: '' })).toBe('id:7')
  })

  it('normalizeProjectName 收空白並限長', () => {
    expect(normalizeProjectName('  Q4   提案 ')).toBe('Q4 提案')
    expect(normalizeProjectName('   ')).toBe('')
    expect(Array.from(normalizeProjectName('字'.repeat(100))).length).toBe(40)
  })

  it('assign／rename／drop 不改原物件', () => {
    const base = { s1: 'A' }
    const a = assignProject(base, 's2', ' B ')
    expect(a).toEqual({ s1: 'A', s2: 'B' })
    expect(base).toEqual({ s1: 'A' })
    expect(assignProject(a, 's1', '')).toEqual({ s2: 'B' })
    expect(renameProject(a, 'A', 'B')).toEqual({ s1: 'B', s2: 'B' })
    expect(renameProject(a, 'A', '  ')).toBe(a)
    expect(dropProject(a, 'A')).toEqual({ s2: 'B' })
  })

  it('sanitizeProjectMap 丟掉壞資料', () => {
    expect(sanitizeProjectMap(null)).toEqual({})
    expect(sanitizeProjectMap([1])).toEqual({})
    expect(sanitizeProjectMap({ a: ' P ', b: 3, c: '  ' })).toEqual({ a: 'P' })
  })

  it('groupThreads project 模式：專案依最新動態、未分組最後、置頂在組內最前', () => {
    const list = [conv(1), conv(2), conv(3), conv(4, { isPinned: true }), conv(5)]
    const map = { s1: 'A', s2: 'B', s3: 'B', s4: 'A' }
    const groups = groupThreads(list, map, { mode: 'project' })
    expect(groups.map(g => g.project)).toEqual(['A', 'B', ''])
    expect(groups[0].threads.map(t => t.id)).toEqual([4, 1])
    expect(groups[1].threads.map(t => t.id)).toEqual([3, 2])
    expect(groups[2].threads.map(t => t.id)).toEqual([5])
  })

  it('groupThreads recent 模式：單組、依時間', () => {
    const groups = groupThreads([conv(1), conv(2)], { s1: 'A' }, { mode: 'recent' })
    expect(groups).toHaveLength(1)
    expect(groups[0].threads.map(t => t.id)).toEqual([2, 1])
  })

  it('空對話不列，除非是目前打開的那個', () => {
    const list = [conv(1, { messageCount: 0 }), conv(2, { messageCount: 0 }), conv(3)]
    expect(groupThreads(list, {}, { mode: 'recent' })[0].threads.map(t => t.id)).toEqual([3])
    expect(groupThreads(list, {}, { mode: 'recent', keepId: 2 })[0].threads.map(t => t.id)).toEqual([3, 2])
    expect(groupThreads([conv(1, { messageCount: 0 })], {}, { mode: 'project' })).toEqual([])
  })

  it('搜尋比對標題與專案名', () => {
    const list = [conv(1, { title: 'Q4 提案' }), conv(2, { title: '搬家' }), conv(3, { title: '雜記' })]
    const map = { s3: 'Q4 專案' }
    const ids = (query: string) => groupThreads(list, map, { mode: 'recent', query }).flatMap(g => g.threads.map(t => t.id))
    expect(ids('q4').sort()).toEqual([1, 3])
    expect(ids('搬')).toEqual([2])
    expect(ids('不存在')).toEqual([])
  })

  it('listProjects 依最新動態，保留對照表裡已沒有對話的專案', () => {
    const list = [conv(1), conv(2), conv(3)]
    const map = { s1: 'A', s2: 'B', gone: 'C' }
    expect(listProjects(list, map)).toEqual(['B', 'A', 'C'])
    expect(projectOf(map, list[0])).toBe('A')
    expect(projectOf(map, list[2])).toBe('')
  })

  it('讀寫 store.json：壞資料與失敗都不丟錯', async () => {
    const data: Record<string, unknown> = {}
    const storage = {
      get: async (key: string) => data[key],
      set: async (key: string, value: unknown) => { data[key] = value },
      save: async () => {},
    }
    expect(await saveProjectMap({ s1: 'A' }, storage)).toBe(true)
    expect(data[THREAD_PROJECTS_KEY]).toEqual({ s1: 'A' })
    expect(await loadProjectMap(storage)).toEqual({ s1: 'A' })
    const broken = { get: async () => { throw new Error('x') }, set: async () => { throw new Error('x') }, save: async () => {} }
    expect(await loadProjectMap(broken)).toEqual({})
    expect(await saveProjectMap({ s1: 'A' }, broken)).toBe(false)
  })
})
