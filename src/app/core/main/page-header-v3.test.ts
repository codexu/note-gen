// @vitest-environment jsdom
// almanac ALMNC-22：新介面不顯示「回到工作區」，舊介面照舊。
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

// page-ui 用 classic JSX runtime：測試環境要有全域 React（同 v3-keyboard.test.ts 的做法）
await vi.hoisted(async () => {
  vi.stubGlobal('React', (await import('react')).default)
})

const { PageHeader } = await import('./page-ui')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(mode: 'v3' | 'classic') {
  const onBack = vi.fn()
  act(() => {
    useUiModeStore.setState({ mode })
    root.render(createElement(PageHeader, { title: '今天', onBack, backShortcut: '⌘⇧H' }))
  })
  return onBack
}

describe('PageHeader back button', () => {
  it('is hidden in the new interface', () => {
    render('v3')
    expect(container.textContent).not.toContain('backToWorkspace')
  })

  it('stays in classic and still goes back', () => {
    const onBack = render('classic')
    const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('backToWorkspace'))
    expect(button).toBeTruthy()
    act(() => button!.click())
    expect(onBack).toHaveBeenCalled()
  })
})
