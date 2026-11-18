// Issue #75：工作區在索引啟動完成前切換時，舊工作區的快取與掃描結果不能寫進 store。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { indexNote } from './index-note'
import { serializeIndexCache } from './index-core'

const cacheFiles = new Map<string, string>()
const gates = new Map<string, Promise<void>>()
let currentWorkspace = '/B'

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: async () => '/app',
  join: async (...parts: string[]) => parts.join('/'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (path: string) => cacheFiles.has(path),
  mkdir: async () => undefined,
  readTextFile: async (path: string) => {
    await gates.get(path)
    return cacheFiles.get(path) ?? ''
  },
  stat: async () => ({ mtime: new Date(1) }),
  watch: async () => () => undefined,
  writeTextFile: async () => undefined,
}))

vi.mock('@/lib/files', () => ({
  getAllMarkdownFiles: async () => [{ relativePath: currentWorkspace === '/A' ? 'a.md' : 'b.md' }],
}))

vi.mock('@/lib/workspace', () => ({
  getWorkspacePath: async () => ({ path: currentWorkspace, isCustom: true }),
  getFilePathOptions: async (relative: string) => ({ path: `${currentWorkspace}/${relative}` }),
}))

function cacheName(workspace: string): string {
  let hash = 5381
  for (let i = 0; i < workspace.length; i++) hash = ((hash << 5) + hash + workspace.charCodeAt(i)) >>> 0
  return `vault-index/${hash.toString(36)}.json`
}

function seedCache(workspace: string, path: string) {
  const note = indexNote(path, `- [ ] task in ${workspace}\n`, 1)
  cacheFiles.set(cacheName(workspace), JSON.stringify(serializeIndexCache(workspace, [note], Date.now())))
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

describe('startVaultIndex workspace switch (#75)', () => {
  beforeEach(() => {
    cacheFiles.clear()
    gates.clear()
    vi.resetModules()
  })

  it('ignores a superseded start whose cache resolves late', async () => {
    const { startVaultIndex } = await import('./service')
    const { default: useVaultIndexStore } = await import('@/stores/vault-index')
    seedCache('/A', 'a.md')
    seedCache('/B', 'b.md')
    let releaseA!: () => void
    gates.set(cacheName('/A'), new Promise<void>(resolve => { releaseA = resolve }))

    currentWorkspace = '/A'
    const first = new AbortController()
    const startA = startVaultIndex('/A', first.signal)
    await settle()

    // 設定載入後工作區換成 B：舊的那次被取消，新的那次啟動
    first.abort()
    currentWorkspace = '/B'
    await startVaultIndex('/B', new AbortController().signal)
    await settle()

    // 舊碼會在這裡先把 A 的任務寫進 store，等 B 重新掃描才恢復（issue 的「之後自行恢復」）
    const seen = new Set<string>()
    const unsubscribe = useVaultIndexStore.subscribe(state => {
      for (const path of state.notes.keys()) seen.add(path)
    })
    releaseA()
    await startA
    await settle()

    const state = useVaultIndexStore.getState()
    expect(state.workspace).toBe('/B')
    expect([...state.notes.keys()]).toEqual(['b.md'])
    unsubscribe()
    expect(seen.has('a.md')).toBe(false)
  })

  it('does not touch the store when aborted before start', async () => {
    const { startVaultIndex } = await import('./service')
    const { default: useVaultIndexStore } = await import('@/stores/vault-index')
    seedCache('/B', 'b.md')
    currentWorkspace = '/B'
    await startVaultIndex('/B', new AbortController().signal)
    await settle()

    const aborted = new AbortController()
    aborted.abort()
    await startVaultIndex('/A', aborted.signal)
    await settle()

    expect(useVaultIndexStore.getState().workspace).toBe('/B')
    expect([...useVaultIndexStore.getState().notes.keys()]).toEqual(['b.md'])
  })
})
