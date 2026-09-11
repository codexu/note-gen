import { emitTo } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { CustomThemeColors } from '@/types/theme'

export const QUICK_RECORD_WINDOW = 'quick-record'

export async function hideQuickRecordWindow(): Promise<void> {
  await invoke('hide_quick_record_window')
}

export interface QuickRecordContext {
  selectedTagId: number
  autoReadClipboard: boolean
  uiScale: number
  appFontFamily: string
  customThemeColors: CustomThemeColors
}

export interface QuickRecordRequest {
  id: string
  action: 'prepare' | 'save'
  text?: string
  tagId?: number
}

export interface QuickRecordResponse {
  id: string
  context?: QuickRecordContext
  saved?: boolean
  error?: 'invalid' | 'failed'
}

export async function requestQuickRecord(request: QuickRecordRequest): Promise<QuickRecordResponse> {
  let unlisten: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<QuickRecordResponse>((resolve, reject) => {
      void (async () => {
        unlisten = await getCurrentWindow().listen<QuickRecordResponse>('quick-record-response', event => {
          if (event.payload.id === request.id) resolve(event.payload)
        })
        timer = setTimeout(() => reject(new Error('timeout')), 15000)
        await emitTo('main', 'quick-record-request', request)
      })().catch(reject)
    })
  } finally {
    unlisten?.()
    clearTimeout(timer)
  }
}
