import { invoke } from '@tauri-apps/api/core'
import { isPermissionGranted } from '@tauri-apps/plugin-notification'

interface ScreenshotNotification {
  title: string
  body: string
}

// Permission is managed in Settings. Never interrupt a screenshot with an
// authorization request, and never turn a notification failure into a save failure.
export async function notifyScreenshotResult(notification: ScreenshotNotification) {
  try {
    if (!(await isPermissionGranted())) return
    // The JS sendNotification API drops the native promise. Await its request
    // here so an IPC error cannot become an unhandled rejection.
    await invoke('plugin:notification|notify', { options: notification })
  } catch (error) {
    console.warn('Unable to send screenshot notification:', error)
  }
}
