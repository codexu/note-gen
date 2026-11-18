// Fork（almanac ALMNC-9）：隨處對話面板標頭要告訴使用者「對話看得到什麼」。純函式。
import { noteTitleParts } from './palette-search'

export type AnywhereContext =
  | { kind: 'selection', title: string, chars: number }
  | { kind: 'note', title: string }
  | { kind: 'none' }

export interface AnywhereContextInput {
  /** 目前開啟的筆記路徑（空字串表示沒有） */
  activePath: string
  /** 編輯器目前選取的文字（沒有選取時為空） */
  selectedText: string
}

/** 有選取內容就以選取為主，其次是目前筆記，都沒有就是「沒有上下文」。 */
export function describeAnywhereContext({ activePath, selectedText }: AnywhereContextInput): AnywhereContext {
  const title = activePath ? noteTitleParts(activePath).title : ''
  const selected = selectedText.trim()
  if (selected) return { kind: 'selection', title, chars: Array.from(selected).length }
  if (title) return { kind: 'note', title }
  return { kind: 'none' }
}

/** 快捷鍵事件是不是「隨處對話」（⌘⇧A / Ctrl+Shift+A，用實體鍵位避開輸入法） */
export function isAnywhereChatShortcut(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'key' | 'code' | 'isComposing'>): boolean {
  if (event.isComposing || event.altKey || !event.shiftKey || !(event.metaKey || event.ctrlKey)) return false
  return event.code === 'KeyA' || event.key.toLowerCase() === 'a'
}

/** ⌘K 開面板。焦點在編輯器（插入連結用 ⌘K）時不攔截。 */
export function isPaletteShortcut(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'key' | 'code' | 'isComposing'>): boolean {
  if (event.isComposing || event.shiftKey || event.altKey || !(event.metaKey || event.ctrlKey)) return false
  return event.code === 'KeyK' || event.key.toLowerCase() === 'k'
}

const EDITOR_SELECTOR = '.ProseMirror, .tiptap-editor, #aritcle-md-editor, .cm-editor, [contenteditable]:not([contenteditable="false"])'

/** 焦點是否在筆記編輯器裡（含 contenteditable 與原始碼模式）。一般輸入框不算。 */
export function isEditorTarget(target: unknown): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null
  return typeof element?.closest === 'function' && Boolean(element.closest(EDITOR_SELECTOR))
}
