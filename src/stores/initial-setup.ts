import { create } from 'zustand'
import {
  createExistingUserSetupProgress,
  persistInitialSetupProgress,
  readInitialSetupProgress,
  type InitialSetupProgress,
  type InitialSetupStep,
} from '@/lib/initial-setup'

interface InitialSetupState extends InitialSetupProgress {
  hydrated: boolean
  visible: boolean
  captureRequested: boolean
  requestCapture: () => void
  consumeCapture: () => void
  focusedStep: 'model' | 'sync' | null
  hydrate: () => Promise<void>
  open: () => Promise<void>
  openStep: (step: 'model' | 'sync') => Promise<void>
  closeStep: () => void
  goTo: (step: InitialSetupStep) => Promise<void>
  complete: () => Promise<void>
}

let hydration: Promise<void> | null = null

export const useInitialSetupStore = create<InitialSetupState>((set, get) => {
  const persist = async () => {
    const { schemaVersion, status, step, isNewInstallation } = get()
    try {
      await persistInitialSetupProgress({ schemaVersion, status, step, isNewInstallation })
    } catch (error) {
      console.error('Failed to save initial setup progress:', error)
    }
  }

  return {
    ...createExistingUserSetupProgress(),
    hydrated: false,
    visible: false,
    captureRequested: false,
    requestCapture: () => set({ captureRequested: true }),
    consumeCapture: () => set({ captureRequested: false }),
    focusedStep: null,
    hydrate: async () => {
      if (get().hydrated) return
      if (!hydration) {
        hydration = (async () => {
          try {
            const progress = await readInitialSetupProgress()
            set({
              ...progress,
              hydrated: true,
              visible: progress.status === 'pending' && progress.isNewInstallation,
            })
          } catch (error) {
            set({ hydrated: true, visible: false })
            console.error('Failed to read initial setup progress:', error)
          }
        })()
      }
      await hydration
    },
    open: async () => {
      await get().hydrate()
      set({ visible: true, focusedStep: null, step: 'welcome' })
    },
    openStep: async (focusedStep) => {
      await get().hydrate()
      if (!get().visible) set({ visible: true, focusedStep })
    },
    closeStep: () => set({ visible: false, focusedStep: null }),
    goTo: async (step) => {
      if (!get().visible || get().focusedStep) return
      set({ step })
      if (get().status === 'pending' && get().isNewInstallation) await persist()
    },
    complete: async () => {
      if (!get().visible) return
      set({ visible: false, status: 'completed' })
      await persist()
    },
  }
})
