// Fork（almanac P0-c）：⌘K（Ctrl+K）把焦點移到側欄搜尋。
// 編輯器裡的 ⌘K 是「插入連結」，所以焦點在可編輯區（contenteditable／輸入框）時不攔截。
import { useEffect, type RefObject } from 'react'

export function useFocusSearchShortcut(inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.shiftKey || event.altKey) return
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      const target = event.target as HTMLElement | null
      const editing = target && target !== inputRef.current
        && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]'))
      if (editing) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inputRef])
}
