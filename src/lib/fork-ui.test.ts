// almanac ALMNC-7：新舊介面開關的讀寫。
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_UI_MODE, UI_MODE_BOOT_SCRIPT, UI_MODE_KEY, isUiV3, normalizeUiMode, useUiModeStore } from './fork-ui'

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  let saves = 0
  return {
    data,
    get saves() { return saves },
    get: async (key: string) => data[key],
    set: async (key: string, value: unknown) => { data[key] = value },
    save: async () => { saves += 1 },
  }
}

describe('ui mode', () => {
  beforeEach(() => {
    useUiModeStore.setState({ mode: DEFAULT_UI_MODE, loaded: false })
  })

  it('defaults to v3 and only accepts classic as the alternative', () => {
    expect(DEFAULT_UI_MODE).toBe('v3')
    expect(normalizeUiMode(undefined)).toBe('v3')
    expect(normalizeUiMode('nonsense')).toBe('v3')
    expect(normalizeUiMode('classic')).toBe('classic')
  })

  it('loads the saved mode from store.json', async () => {
    const storage = memoryStorage({ [UI_MODE_KEY]: 'classic' })
    expect(await useUiModeStore.getState().load(storage)).toBe('classic')
    expect(useUiModeStore.getState()).toMatchObject({ mode: 'classic', loaded: true })
    expect(isUiV3()).toBe(false)
  })

  it('persists a change and saves the store', async () => {
    const storage = memoryStorage()
    await useUiModeStore.getState().setMode('classic', storage)
    expect(storage.data[UI_MODE_KEY]).toBe('classic')
    expect(storage.saves).toBe(1)
    await useUiModeStore.getState().setMode('v3', storage)
    expect(storage.data[UI_MODE_KEY]).toBe('v3')
    expect(isUiV3()).toBe(true)
  })

  it('follows another window without writing back', () => {
    useUiModeStore.getState().syncFromOtherWindow('classic')
    expect(useUiModeStore.getState().mode).toBe('classic')
    useUiModeStore.getState().syncFromOtherWindow(null)
    expect(useUiModeStore.getState().mode).toBe('v3')
  })

  it('boot script reads the same key', () => {
    expect(UI_MODE_BOOT_SCRIPT).toContain(`'${UI_MODE_KEY}'`)
  })
})
