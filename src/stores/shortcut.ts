import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut'
import { globalShortcutIdentity, normalizeGlobalShortcut } from '@/lib/global-shortcut'
import emitter from '@/lib/emitter'

interface Shortcut {
  key: string
  value: string
}

type ShortcutErrorCode = 'registrationFailed' | 'saveFailed' | 'invalidShortcut'

export class ShortcutUpdateError extends Error {
  constructor(public readonly code: ShortcutErrorCode, public readonly conflictKey?: string) {
    super(code)
  }
}

interface SettingState {
  shortcuts: Shortcut[]
  activeShortcuts: Shortcut[]
  initialized: boolean
  registrationErrors: Record<string, ShortcutErrorCode>
  recordingShortcut: string | null
  setRecordingShortcut: (key: string | null) => void
  initShortcut: () => Promise<void>
  setShortcut: (key: string, value: string) => Promise<void>
  resetDefault: (key: string) => Promise<void>
}

const defaultShortcuts: Shortcut[] = [
  { key: 'openWindow', value: 'CommandOrControl+Shift+W' },
  { key: 'screenshotRecord', value: 'CommandOrControl+Shift+S' },
  { key: 'quickRecordText', value: 'CommandOrControl+Shift+T' },
]

let pendingUpdate = Promise.resolve()

function serializeUpdate(operation: () => Promise<void>) {
  const update = pendingUpdate.then(operation)
  pendingUpdate = update.catch(() => undefined)
  return update
}

async function registerShortcut(shortcut: Shortcut) {
  await register(shortcut.value, (event) => {
    const state = useShortcutStore.getState()
    if (event.state !== 'Pressed' || state.recordingShortcut || !state.activeShortcuts.some((item) => (
      item.key === shortcut.key && globalShortcutIdentity(item.value) === globalShortcutIdentity(shortcut.value)
    ))) return

    emitter.emit(shortcut.key === 'screenshotRecord' ? 'desktop-screenshot-trigger' : shortcut.key)
  })
}

const useShortcutStore = create<SettingState>((set, get) => ({
  shortcuts: [],
  activeShortcuts: [],
  initialized: false,
  registrationErrors: {},
  recordingShortcut: null,
  setRecordingShortcut: (key) => set({ recordingShortcut: key }),

  initShortcut: () => serializeUpdate(async () => {
    if (get().initialized) return
    const store = await Store.load('store.json')
    const storedShortcuts = await store.get<Shortcut[]>('shortcuts')
    const shortcuts = defaultShortcuts.map((shortcut) => (
      storedShortcuts?.find((item) => item.key === shortcut.key) ?? shortcut
    ))
    const activeShortcuts: Shortcut[] = []
    const registrationErrors: Record<string, ShortcutErrorCode> = {}

    for (const shortcut of shortcuts) {
      if (!shortcut.value) continue
      const value = normalizeGlobalShortcut(shortcut.value)
      if (!value) {
        registrationErrors[shortcut.key] = 'invalidShortcut'
        continue
      }
      if (activeShortcuts.some((item) => globalShortcutIdentity(item.value) === globalShortcutIdentity(value))) {
        registrationErrors[shortcut.key] = 'registrationFailed'
        continue
      }
      try {
        // A webview reload leaves native registrations alive with the old JS
        // channel. Rebind only these app-owned settings; preserve other keys.
        if (await isRegistered(value)) await unregister(value)
        await registerShortcut({ ...shortcut, value })
        activeShortcuts.push({ ...shortcut, value })
      } catch (error) {
        console.error(`Failed to register shortcut ${shortcut.value}:`, error)
        registrationErrors[shortcut.key] = 'registrationFailed'
      }
    }

    set({ shortcuts, activeShortcuts, registrationErrors, initialized: true })
    if (!storedShortcuts?.length) {
      await store.set('shortcuts', shortcuts)
      await store.save()
    }
  }),

  setShortcut: (key, inputValue) => serializeUpdate(async () => {
    const value = normalizeGlobalShortcut(inputValue)
    if (inputValue && !value) throw new ShortcutUpdateError('invalidShortcut')
    const { shortcuts, activeShortcuts } = get()
    const previous = activeShortcuts.find((item) => item.key === key)
    const conflict = shortcuts.find((item) => (
      item.key !== key && value && globalShortcutIdentity(item.value) === globalShortcutIdentity(value)
    ))
    if (conflict) throw new ShortcutUpdateError('registrationFailed', conflict.key)
    if (!shortcuts.some((item) => item.key === key)) return
    const changedRegistration = globalShortcutIdentity(previous?.value ?? '') !== globalShortcutIdentity(value)
    if (!changedRegistration && shortcuts.find((item) => item.key === key)?.value === value) return

    const nextShortcuts = shortcuts.map((item) => item.key === key ? { ...item, value } : item)
    if (value && changedRegistration) {
      try {
        // Keep the old binding active until the replacement is accepted by the OS.
        await registerShortcut({ key, value })
      } catch (error) {
        console.error(`Failed to register shortcut ${value}:`, error)
        throw new ShortcutUpdateError('registrationFailed')
      }
    }

    let saved = false
    try {
      const store = await Store.load('store.json')
      await store.set('shortcuts', nextShortcuts)
      await store.save()
      saved = true
      if (previous?.value && changedRegistration) await unregister(previous.value)
    } catch (error) {
      console.error('Failed to update shortcuts:', error)
      if (value && changedRegistration) {
        await unregister(value).catch((cleanupError) => console.error('Failed to release new shortcut:', cleanupError))
      }
      try {
        const store = await Store.load('store.json')
        await store.set('shortcuts', shortcuts)
        await store.save()
      } catch (restoreError) {
        console.error('Failed to restore shortcut settings:', restoreError)
      }
      throw new ShortcutUpdateError(saved ? 'registrationFailed' : 'saveFailed')
    }

    const registrationErrors = { ...get().registrationErrors }
    delete registrationErrors[key]
    set({
      shortcuts: nextShortcuts,
      activeShortcuts: [
        ...activeShortcuts.filter((item) => item.key !== key),
        ...(value ? [{ key, value }] : []),
      ],
      registrationErrors,
    })
  }),

  resetDefault: (key) => get().setShortcut(key, defaultShortcuts.find((item) => item.key === key)?.value ?? ''),
}))

export default useShortcutStore
