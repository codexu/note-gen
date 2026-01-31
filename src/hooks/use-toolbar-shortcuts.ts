import { useEffect, useState, useRef } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { register, unregister } from '@tauri-apps/plugin-global-shortcut'
import emitter from '@/lib/emitter'
import useSettingStore from '@/stores/setting'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

export function useToolbarShortcuts() {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isModifierPressed, setIsModifierPressed] = useState(false)
  const { recordToolbarConfig } = useSettingStore()
  const registeredShortcutsRef = useRef<string[]>([])

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
    } catch (error) {
      console.error('Error detecting platform:', error)
    }
  }, [])

  // 注册快捷键
  useEffect(() => {
    if (currentPlatform === 'unknown') return

    const modifierKey = currentPlatform === 'macos' ? 'Command' : 'Alt'
    
    const registerShortcuts = async () => {
      // 先注销之前注册的快捷键
      for (const shortcut of registeredShortcutsRef.current) {
        try {
          await unregister(shortcut)
        } catch {
          // 忽略注销错误
        }
      }
      registeredShortcutsRef.current = []

      // 获取启用的工具栏项并按顺序排序
      const enabledItems = recordToolbarConfig
        .filter(item => item.enabled)
        .sort((a, b) => a.order - b.order)

      // 为每个工具栏项注册快捷键
      for (let i = 0; i < enabledItems.length && i < 9; i++) {
        const item = enabledItems[i]
        const shortcutKey = `${modifierKey}+${i + 1}`
        
        try {
          await register(shortcutKey, (event) => {
            if (event.state === 'Pressed') {
              emitter.emit(`toolbar-shortcut-${item.id}` as any)
            }
          })
          registeredShortcutsRef.current.push(shortcutKey)
        } catch (error) {
          // 忽略已注册的快捷键错误，继续注册其他快捷键
          console.warn(`Shortcut ${shortcutKey} already registered or failed:`, error)
        }
      }
    }

    registerShortcuts()

    return () => {
      // 组件卸载时清理快捷键
      const cleanup = async () => {
        for (const shortcut of registeredShortcutsRef.current) {
          try {
            await unregister(shortcut)
          } catch {
            // 忽略注销错误
          }
        }
      }
      cleanup()
    }
  }, [currentPlatform, recordToolbarConfig])

  // 监听修饰键按下状态
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (currentPlatform === 'macos' && e.metaKey) {
        setIsModifierPressed(true)
      } else if ((currentPlatform === 'windows' || currentPlatform === 'linux') && e.altKey) {
        setIsModifierPressed(true)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (currentPlatform === 'macos' && !e.metaKey) {
        setIsModifierPressed(false)
      } else if ((currentPlatform === 'windows' || currentPlatform === 'linux') && !e.altKey) {
        setIsModifierPressed(false)
      }
    }

    const handleBlur = () => {
      setIsModifierPressed(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [currentPlatform])

  return {
    isModifierPressed,
    currentPlatform,
  }
}
