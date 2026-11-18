// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import zhTW from '../../../../messages/zh-TW.json'
import { useAnywhereStore } from '@/lib/anywhere/store'
import emitter from '@/lib/emitter'
import { useUiModeStore } from '@/lib/fork-ui'
import { useWeekOverlay } from '@/lib/week/overlay'
import useCollectStore from '@/stores/collect'
import useHomeStore from '@/stores/home'
import useSettingStore from '@/stores/setting'
import { AnywhereService } from './anywhere/anywhere-service'
import { LeftSidebar } from './left-sidebar'
import { PageSurface } from './page-ui'
import { TodayComposer } from './today-v3/composer'
import { CopyButton } from './editor/markdown/footer-bar/copy-button'
import { ExportButton } from './editor/markdown/footer-bar/export-button'
import type { Editor } from '@tiptap/react'

// The sidebar routes via the real overlay stores. File, calendar and plugin
// views are outside this flow and would start desktop IO in jsdom.
vi.mock('./file', () => ({ FileSidebar: () => null }))
vi.mock('./file/file-actions', () => ({ FileActions: () => null }))
vi.mock('./daily/sidebar-calendar', () => ({ SidebarCalendar: () => null }))
vi.mock('./canvas/canvas-sidebar', () => ({ CanvasActions: () => null, CanvasSidebar: () => null }))
vi.mock('./sidebar-search', () => ({ SidebarSearch: () => null }))
vi.mock('./editor/markdown/outline', () => ({ Outline: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./anywhere/chat-panel', () => ({ AnywhereChatPanel: () => null }))
vi.mock('@/lib/collect/ai', () => ({ askCollectModel: async () => null }))
vi.mock('@/db/agents', () => ({ listAgentSettings: async () => [] }))

await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
  // Node's optional localStorage global can shadow jsdom's Storage.
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useUiModeStore.setState({ mode: 'v3' })
  useAnywhereStore.setState({ chatOpen: false, paletteOpen: false })
  useCollectStore.setState({ items: [] })
  useHomeStore.getState().hide()
  useWeekOverlay.getState().hide()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function render(children: React.ReactNode) {
  const providerProps = { locale: 'zh-TW', messages: zhTW, timeZone: 'Asia/Taipei', children }
  await act(async () => root.render(React.createElement(NextIntlClientProvider, providerProps)))
}

function keyDown(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  target.dispatchEvent(event)
  return event
}

it('maps the visible Plan entry to the week overlay and removes the V3 navigation in classic', async () => {
  await render(React.createElement(LeftSidebar))
  const nav = host.querySelector('[data-sidebar-v3] nav')!
  const plan = [...nav.querySelectorAll('button')].find(button => button.textContent === zhTW.sidebarV3.nav.plan)!
  await act(async () => plan.click())
  expect(useWeekOverlay.getState().visible).toBe(true)
  expect(plan.getAttribute('aria-current')).toBe('page')

  const storage = { get: async () => 'v3', set: async () => {}, save: async () => {} }
  await act(async () => useUiModeStore.getState().setMode('classic', storage))
  expect(host.querySelector('[data-sidebar-v3]')).toBeNull()
  expect(host.querySelector('nav')?.textContent).toContain('Overview')
  expect(host.querySelector('nav')?.textContent).not.toContain('Decide')
})

it('switches to Ask with Tab and lets the next Tab and Shift+Tab leave the input', async () => {
  await render(React.createElement(TodayComposer))
  const input = host.querySelector('input')!
  let first!: KeyboardEvent
  await act(async () => { first = keyDown(input, 'Tab') })
  expect(first.defaultPrevented).toBe(true)
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe(zhTW.todayV3.composer.ask)
  await act(async () => { first = keyDown(input, 'Tab') })
  expect(first.defaultPrevented).toBe(false)
  expect(keyDown(input, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false)
})

it('moves focus into a V3 page and returns focus to its opener after Escape', async () => {
  function Launcher() {
    const [open, setOpen] = React.useState(false)
    const surfaceProps = { label: 'Review', onDismiss: () => setOpen(false), children: 'Review' }
    return React.createElement(React.Fragment, null,
      React.createElement('button', { onClick: () => setOpen(true) }, 'Open'),
      open && React.createElement(PageSurface, surfaceProps),
    )
  }
  await render(React.createElement(Launcher))
  const opener = host.querySelector('button')!
  opener.focus()
  await act(async () => opener.click())
  const surface = host.querySelector<HTMLElement>('[aria-label="Review"]')!
  expect(document.activeElement).toBe(surface)
  await act(async () => keyDown(surface, 'Escape', { isComposing: true }))
  expect(surface.isConnected).toBe(true)
  await act(async () => keyDown(surface, 'Escape'))
  expect(surface.isConnected).toBe(false)
  expect(document.activeElement).toBe(opener)
})

it('localizes the visible copy and export actions in the editor status bar', async () => {
  // Neither trigger touches the editor until an export format is selected.
  const editor = {} as Editor
  await render(React.createElement(React.Fragment, null,
    React.createElement(CopyButton, { editor }),
    React.createElement(ExportButton, { editor }),
  ))
  expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(['複製', '匯出'])
})

it('opens the named command palette with ⌘K and returns focus on Escape', async () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} })
  try {
    await render(React.createElement(React.Fragment, null,
      React.createElement('button', null, 'Workspace'),
      React.createElement(AnywhereService),
    ))
    const opener = host.querySelector('button')!
    opener.focus()
    await act(async () => keyDown(opener, 'k', { metaKey: true, code: 'KeyK' }))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(zhTW.anywhere.palette.title)
    expect(document.activeElement?.getAttribute('aria-label')).toBe(zhTW.anywhere.palette.placeholder)
    await act(async () => keyDown(document.activeElement as HTMLElement, 'Escape'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  } finally {
    if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  }
})

async function typeIn(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('submits a note with Enter after IME composition ends', async () => {
  await render(React.createElement(TodayComposer))
  const input = host.querySelector('input')!
  await typeIn(input, '先閱讀提案')

  await act(async () => keyDown(input, 'Enter', { isComposing: true }))
  expect(useCollectStore.getState().items).toHaveLength(0)
  await act(async () => keyDown(input, 'Enter'))
  expect(useCollectStore.getState().items[0]?.input.text).toBe('先閱讀提案')
  expect(input.value).toBe('')
})

it('opens Anywhere chat and sends the question when Enter is pressed in Ask mode', async () => {
  const originalModel = useSettingStore.getState().primaryModel
  useSettingStore.setState({ primaryModel: 'test-model' })
  const prompts: string[] = []
  const onSend = (prompt: string) => prompts.push(prompt)
  emitter.on('quick-prompt-send', onSend)
  try {
    await render(React.createElement(TodayComposer))
    const input = host.querySelector('input')!
    await act(async () => keyDown(input, 'Tab'))
    await typeIn(input, '提案要改哪裡？')
    await act(async () => keyDown(input, 'Enter'))
    expect(useAnywhereStore.getState().chatOpen).toBe(true)
    expect(input.value).toBe('')
    await vi.waitFor(() => expect(prompts).toEqual(['提案要改哪裡？']))
    expect(useCollectStore.getState().items).toEqual([])
  } finally {
    await act(async () => useSettingStore.setState({ primaryModel: originalModel }))
    emitter.off('quick-prompt-send', onSend)
  }
})
