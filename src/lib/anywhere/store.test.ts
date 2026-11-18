import { beforeEach, describe, expect, it } from 'vitest'
import { useAnywhereStore } from './store'

describe('anywhere store', () => {
  beforeEach(() => useAnywhereStore.setState({ paletteOpen: false, chatOpen: false }))

  it('never keeps the palette and the chat panel open together', () => {
    const s = useAnywhereStore.getState()
    s.togglePalette()
    expect(useAnywhereStore.getState()).toMatchObject({ paletteOpen: true, chatOpen: false })
    useAnywhereStore.getState().toggleChat()
    expect(useAnywhereStore.getState()).toMatchObject({ paletteOpen: false, chatOpen: true })
    useAnywhereStore.getState().setPaletteOpen(true)
    expect(useAnywhereStore.getState()).toMatchObject({ paletteOpen: true, chatOpen: false })
  })

  it('toggles closed again', () => {
    useAnywhereStore.getState().toggleChat()
    useAnywhereStore.getState().toggleChat()
    expect(useAnywhereStore.getState().chatOpen).toBe(false)
  })
})
