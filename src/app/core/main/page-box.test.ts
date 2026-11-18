// @vitest-environment jsdom
// almanac ALMNC-24：v3 全頁畫面只蓋中間面板，左右側欄固定露出。
import { describe, expect, it } from 'vitest'
import { measurePageBox } from './page-box'

function el(rect: { left: number, right: number, top?: number, bottom?: number }, init?: (node: HTMLElement) => void) {
  const node = document.createElement('div')
  init?.(node)
  const box = { top: 0, bottom: 800, ...rect }
  node.getBoundingClientRect = () => ({ ...box, width: box.right - box.left, height: box.bottom - box.top, x: box.left, y: box.top, toJSON: () => box }) as DOMRect
  return node
}

function layout(centerRight: number) {
  const container = el({ left: 0, right: 1200, bottom: 828 })
  const group = el({ left: 0, right: 1200 })
  const left = el({ left: 0, right: 240 }, node => {
    const sidebar = document.createElement('div')
    sidebar.setAttribute('data-left-sidebar', '')
    node.append(sidebar)
  })
  const center = el({ left: 241, right: centerRight }, node => { node.id = 'center' })
  const right = el({ left: centerRight + 1, right: 1200 }, node => { node.id = 'right' })
  return { container, group, panels: [left, center, right] }
}

describe('measurePageBox', () => {
  it('v3 keeps the page inside the center panel so both sidebars stay visible', () => {
    const { container, group, panels } = layout(840)
    const box = measurePageBox(container, group, panels, true)
    expect(box.left).toBe(241)
    expect(box.right).toBe(1200 - 840)
  })

  it('classic still covers up to the right edge', () => {
    const { container, group, panels } = layout(840)
    expect(measurePageBox(container, group, panels).right).toBe(0)
  })

  it('v3 falls back to the right edge when the center panel is collapsed', () => {
    const { container, group, panels } = layout(241)
    expect(measurePageBox(container, group, panels, true).right).toBe(0)
  })
})
