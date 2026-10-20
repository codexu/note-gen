import { invoke, transformCallback } from '@tauri-apps/api/core'
import type { Event, EventCallback, EventName, EventTarget, UnlistenFn } from '@tauri-apps/api/event'

interface CallbackRegistry {
  unregisterCallback: (id: number) => void
}

// Tauri 2.11 can resolve listen() before its listener-table script executes.
// Keep the callback ID so disposal does not read that still-missing table entry.
export async function listenTauriEvent<T>(event: EventName, handler: EventCallback<T>, target: EventTarget = { kind: 'Any' }): Promise<UnlistenFn> {
  const registry = (window as unknown as { __TAURI_INTERNALS__: CallbackRegistry }).__TAURI_INTERNALS__
  let disposed = false
  const callbackId = transformCallback<Event<T>>(message => {
    if (!disposed) handler(message)
  })

  let eventId: number
  try {
    eventId = await invoke<number>('plugin:event|listen', {
      event,
      target,
      handler: callbackId,
    })
  } catch (error) {
    registry.unregisterCallback(callbackId)
    throw error
  }

  return () => {
    if (disposed) return
    disposed = true
    registry.unregisterCallback(callbackId)
    void invoke('plugin:event|unlisten', { event, eventId }).catch(error => {
      console.error('Failed to unregister native event listener:', event, error)
    })
  }
}
