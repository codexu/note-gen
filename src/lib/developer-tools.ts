import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'

export function supportsNativeDeveloperTools(): boolean {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in globalThis)) return false
  try {
    const currentPlatform = platform()
    return currentPlatform !== 'android' && currentPlatform !== 'ios'
  } catch {
    return false
  }
}

export async function openDeveloperTools(): Promise<void> {
  if (!supportsNativeDeveloperTools()) return
  await invoke('open_developer_tools')
}

export async function closeDeveloperTools(): Promise<void> {
  if (!supportsNativeDeveloperTools()) return
  await invoke('close_developer_tools')
}

export async function isDeveloperToolsOpen(): Promise<boolean> {
  if (!supportsNativeDeveloperTools()) return false
  return invoke<boolean>('is_developer_tools_open')
}
