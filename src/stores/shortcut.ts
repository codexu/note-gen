import { create } from 'zustand';
import { Store } from "@tauri-apps/plugin-store";
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import emitter from '@/lib/emitter';

interface Shortcut {
  key: string,
  value: string,
}

interface SettingState {
  shortcuts: Shortcut[],
  initShortcut: () => Promise<void>,
  setShortcut: (key: string, value: string) => Promise<void>,
  resetDefault: (key: string) => Promise<void>,
}

const defaultShortcuts: Shortcut[] = [
  {
    key: "openWindow",
    value: "CommandOrControl+Shift+W"
  },
  {
    key: 'quickRecordText',
    value: 'CommandOrControl+Shift+T'
  }
]

async function bindShortcut(shortcut: Shortcut) {
  await unregisterAll()
  try {
    if (shortcut.value) {
      await register(shortcut.value, (event) => {
        if (event.state === 'Pressed') {
          emitter.emit(shortcut.key)
        }
      });
    }
  } catch (error) {
    console.error(`Failed to register shortcut ${shortcut.value}:`, error);
  }
}

const useShortcutStore = create<SettingState>((set, get) => ({
  shortcuts: [],

  initShortcut: async () => {
    const store = await Store.load('store.json');
    const shortcuts = await store.get<Shortcut[]>('shortcuts')
    if (shortcuts && shortcuts.length) {
      const mergeShortcuts = defaultShortcuts.map((shortcut) => {
        const existShortcut = shortcuts.find((shortcutItem) => shortcutItem.key === shortcut.key)
        if (existShortcut) {
          return existShortcut
        } else {
          return shortcut
        }
      })
      set({ shortcuts: mergeShortcuts })
      mergeShortcuts.forEach(async (shortcut) => {
        await bindShortcut(shortcut)
      })
    } else {
      await store.set('shortcuts', defaultShortcuts)
      set({ shortcuts: defaultShortcuts })
      defaultShortcuts.forEach(async (shortcut) => {
        await bindShortcut(shortcut)
      })
    }
  },

  setShortcut: async (key: string, value: string) => {
    const store = await Store.load('store.json');
    const newShortcuts = get().shortcuts.map((shortcut) => {
      if (shortcut.key === key) {
        return { ...shortcut, value }
      }
      return shortcut
    })
    await store.set('shortcuts', newShortcuts)
    set({ shortcuts: newShortcuts })
    newShortcuts.forEach(async (shortcut: Shortcut) => {
      await bindShortcut(shortcut)
    })
  },

  resetDefault: async (key: string) => {
    const store = await Store.load('store.json');
    const newShortcuts = get().shortcuts.map((shortcut) => {
      if (shortcut.key === key) {
        return { ...shortcut, value: defaultShortcuts.find((shortcut) => shortcut.key === key)?.value || '' }
      }
      return shortcut
    })
    await store.set('shortcuts', newShortcuts)
    set({ shortcuts: newShortcuts })
    newShortcuts.forEach(async (shortcut: Shortcut) => {
      await bindShortcut(shortcut)
    })
  },
}))

export default useShortcutStore