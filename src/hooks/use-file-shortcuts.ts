import { useEffect, useCallback, useState } from 'react'
import { isMobileDevice } from '@/lib/check'
import { platform } from '@tauri-apps/plugin-os'
import useArticleStore from '@/stores/article'
import { useInitialSetupStore } from '@/stores/initial-setup'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

interface FileShortcutsProps {
  path: string
  isEditing?: boolean
  onStartRename?: () => void
  onCopy?: () => void
  onPaste?: () => void
  onCut?: () => void
  onDelete?: () => void
}

/**
 * 文件和文件夹快捷键 Hook
 * 桌面端：
 *   - macOS: Enter 键触发重命名，Cmd+C 复制，Cmd+V 粘贴，Cmd+X 剪切，Backspace 删除
 *   - Windows/Linux: F2 键触发重命名，Ctrl+C 复制，Ctrl+V 粘贴，Ctrl+X 剪切，Delete 删除
 * 移动端：不启用快捷键
 */
export function useFileShortcuts({
  path,
  isEditing,
  onStartRename,
  onCopy,
  onPaste,
  onCut,
  onDelete
}: FileShortcutsProps) {
  const { activeFilePath } = useArticleStore()
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')

  // 检测当前平台
  useEffect(() => {
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch {
      setCurrentPlatform('unknown')
    }
  }, [])

  // 检查是否按下了正确的修饰键
  const isModKey = useCallback((e: KeyboardEvent | React.KeyboardEvent): boolean => {
    if (currentPlatform === 'macos') {
      return e.metaKey && !e.ctrlKey
    } else {
      return e.ctrlKey && !e.metaKey
    }
  }, [currentPlatform])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (useInitialSetupStore.getState().visible) return
    // 移动端不处理快捷键
    if (isMobileDevice()) {
      return
    }

    // 正在编辑时也忽略
    if (isEditing === true) {
      return
    }

    // 只处理选中的文件/文件夹
    if (path !== activeFilePath) {
      return
    }

    const modPressed = isModKey(e)

    // 重命名: macOS 使用 Enter 键，Windows/Linux 使用 F2 键
    const isRenameKey = currentPlatform === 'macos'
      ? e.key === 'Enter'
      : e.key === 'F2'

    if (isRenameKey && onStartRename) {
      e.preventDefault()
      e.stopPropagation()
      onStartRename()
      return
    }

    // 复制: Cmd+C / Ctrl+C
    if (modPressed && e.key === 'c' && onCopy) {
      e.preventDefault()
      e.stopPropagation()
      onCopy()
      return
    }

    // 粘贴: Cmd+V / Ctrl+V
    if (modPressed && e.key === 'v' && onPaste) {
      e.preventDefault()
      e.stopPropagation()
      onPaste()
      return
    }

    // 剪切: Cmd+X / Ctrl+X
    if (modPressed && e.key === 'x' && onCut) {
      e.preventDefault()
      e.stopPropagation()
      onCut()
      return
    }

    // 删除: macOS 使用 Backspace，Windows/Linux 使用 Delete
    const isDeleteKey = currentPlatform === 'macos'
      ? e.key === 'Backspace'
      : e.key === 'Delete'

    if (isDeleteKey && onDelete) {
      e.preventDefault()
      e.stopPropagation()
      onDelete()
      return
    }
  }, [activeFilePath, isEditing, onStartRename, onCopy, onPaste, onCut, onDelete, path, currentPlatform, isModKey])

  useEffect(() => {
    // 移动端不添加事件监听
    if (isMobileDevice() || currentPlatform === 'unknown') {
      return
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown, currentPlatform])

  return { currentPlatform, isModKey }
}
