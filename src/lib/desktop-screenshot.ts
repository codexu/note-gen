import { invoke } from '@tauri-apps/api/core'

export interface DesktopScreenshotResult {
  sessionId: string
  path: string
  width: number
  height: number
}

export interface DesktopScreenshotError {
  code: string
  message: string
}

let opening: Promise<string> | undefined

export function beginDesktopScreenshot() {
  if (!opening) {
    opening = invoke<string>('begin_desktop_screenshot').finally(() => {
      opening = undefined
    })
  }

  return opening
}

export function readDesktopScreenshotError(error: unknown): DesktopScreenshotError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return { code: String(error.code), message: String(error.message) }
  }

  return {
    code: 'capture-failed',
    message: error instanceof Error ? error.message : String(error),
  }
}
