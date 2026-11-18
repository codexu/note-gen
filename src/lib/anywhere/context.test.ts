import { describe, expect, it } from 'vitest'
import { describeAnywhereContext, isAnywhereChatShortcut, isEditorTarget, isPaletteShortcut } from './context'

const key = (init: Partial<KeyboardEvent>) => ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '', code: '', isComposing: false, ...init })

describe('describeAnywhereContext', () => {
  it('prefers the selection, then the note, then nothing', () => {
    expect(describeAnywhereContext({ activePath: 'a/預算.md', selectedText: ' 三個字 ' })).toEqual({ kind: 'selection', title: '預算', chars: 3 })
    expect(describeAnywhereContext({ activePath: 'a/預算.md', selectedText: '  ' })).toEqual({ kind: 'note', title: '預算' })
    expect(describeAnywhereContext({ activePath: '', selectedText: '' })).toEqual({ kind: 'none' })
  })
})

describe('shortcuts', () => {
  it('⌘K opens the palette, but not with shift/alt or during composition', () => {
    expect(isPaletteShortcut(key({ metaKey: true, key: 'k', code: 'KeyK' }))).toBe(true)
    expect(isPaletteShortcut(key({ ctrlKey: true, key: 'K', code: 'KeyK' }))).toBe(true)
    expect(isPaletteShortcut(key({ metaKey: true, shiftKey: true, key: 'k', code: 'KeyK' }))).toBe(false)
    expect(isPaletteShortcut(key({ metaKey: true, key: 'k', code: 'KeyK', isComposing: true }))).toBe(false)
    expect(isPaletteShortcut(key({ key: 'k', code: 'KeyK' }))).toBe(false)
  })

  it('⌘⇧A opens the chat panel and uses the physical key under an IME', () => {
    expect(isAnywhereChatShortcut(key({ metaKey: true, shiftKey: true, key: 'A', code: 'KeyA' }))).toBe(true)
    expect(isAnywhereChatShortcut(key({ metaKey: true, shiftKey: true, key: 'ㄇ', code: 'KeyA' }))).toBe(true)
    expect(isAnywhereChatShortcut(key({ metaKey: true, key: 'a', code: 'KeyA' }))).toBe(false)
  })
})

describe('isEditorTarget', () => {
  it('asks the element whether it sits inside the note editor', () => {
    const seen: string[] = []
    const inEditor = { closest: (selector: string) => { seen.push(selector); return {} } }
    const plain = { closest: () => null }
    expect(isEditorTarget(inEditor)).toBe(true)
    expect(seen[0]).toContain('.ProseMirror')
    expect(seen[0]).toContain('#aritcle-md-editor')
    expect(isEditorTarget(plain)).toBe(false)
    expect(isEditorTarget(null)).toBe(false)
    expect(isEditorTarget({})).toBe(false)
  })
})
