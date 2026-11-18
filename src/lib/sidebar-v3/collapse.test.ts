import { beforeEach, describe, expect, it } from 'vitest'
import {
  SIDEBAR_AGENTS_COLLAPSED_KEY, SIDEBAR_VAULT_COLLAPSED_KEY, normalizeCollapsed, useSidebarCollapse,
} from './collapse'

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  return {
    data,
    get: async (key: string) => data[key],
    set: async (key: string, value: unknown) => { data[key] = value },
    save: async () => {},
  }
}

describe('sidebar collapse state', () => {
  beforeEach(() => {
    useSidebarCollapse.setState({ agents: true, vault: false, loaded: false })
  })

  it('defaults to agents collapsed and the vault tree open', async () => {
    await useSidebarCollapse.getState().load(memoryStorage())
    const state = useSidebarCollapse.getState()
    expect([state.agents, state.vault, state.loaded]).toEqual([true, false, true])
  })

  it('restores saved values from store.json', async () => {
    await useSidebarCollapse.getState().load(memoryStorage({
      [SIDEBAR_AGENTS_COLLAPSED_KEY]: false,
      [SIDEBAR_VAULT_COLLAPSED_KEY]: true,
    }))
    const state = useSidebarCollapse.getState()
    expect([state.agents, state.vault]).toEqual([false, true])
  })

  it('writes a toggle to store.json and flips only that section', async () => {
    const storage = memoryStorage()
    await useSidebarCollapse.getState().toggle('agents', storage)
    expect(storage.data[SIDEBAR_AGENTS_COLLAPSED_KEY]).toBe(false)
    expect(storage.data[SIDEBAR_VAULT_COLLAPSED_KEY]).toBeUndefined()
    await useSidebarCollapse.getState().toggle('vault', storage)
    expect(storage.data[SIDEBAR_VAULT_COLLAPSED_KEY]).toBe(true)
    expect(useSidebarCollapse.getState().agents).toBe(false)
  })

  it('ignores non-boolean saved values', () => {
    expect(normalizeCollapsed('yes', true)).toBe(true)
    expect(normalizeCollapsed(undefined, false)).toBe(false)
    expect(normalizeCollapsed(false, true)).toBe(false)
  })
})
