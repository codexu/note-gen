import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { hideWhen, linkExclusiveOverlays } from './exclusive'

function overlay() {
  return create<{ visible: boolean, show: () => void, hide: () => void }>(set => ({
    visible: false,
    show: () => set({ visible: true }),
    hide: () => set({ visible: false }),
  }))
}

describe('linkExclusiveOverlays', () => {
  it('keeps at most one overlay open', () => {
    const [a, b, c] = [overlay(), overlay(), overlay()]
    const unlink = linkExclusiveOverlays([a, b, c])
    a.getState().show()
    b.getState().show()
    expect([a, b, c].map(s => s.getState().visible)).toEqual([false, true, false])
    c.getState().show()
    expect([a, b, c].map(s => s.getState().visible)).toEqual([false, false, true])
    unlink()
    a.getState().show()
    expect(c.getState().visible).toBe(true)
  })

  it('hides V3-only overlays when the condition holds', () => {
    const [a, b] = [overlay(), overlay()]
    a.getState().show()
    hideWhen(() => false, [a, b])
    expect(a.getState().visible).toBe(true)
    hideWhen(() => true, [a, b])
    expect(a.getState().visible).toBe(false)
  })
})
