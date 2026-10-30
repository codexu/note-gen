import { create } from 'zustand'

import useSettingStore from '@/stores/setting'
import { listSelfHostedNoteConflicts, type SelfHostedNoteConflictSummary } from '@/lib/self-hosted-sync/conflicts'

interface SelfHostedConflictState {
  workspacePath: string | null
  conflicts: SelfHostedNoteConflictSummary[]
  requestedId: string | null
  request: (id: string) => void
  clearRequest: (id: string) => void
  refresh: () => Promise<void>
}

let refreshSequence = 0

export const useSelfHostedConflictStore = create<SelfHostedConflictState>((set, get) => ({
  workspacePath: null,
  conflicts: [],
  requestedId: null,
  request: requestedId => set({ requestedId }),
  clearRequest: id => {
    if (get().requestedId === id) set({ requestedId: null })
  },
  refresh: async () => {
    const sequence = ++refreshSequence
    const { workspacePath, primaryBackupMethod } = useSettingStore.getState()
    if (primaryBackupMethod !== 'selfHosted') {
      set({ workspacePath: null, conflicts: [], requestedId: null })
      return
    }
    if (get().workspacePath !== workspacePath) {
      set({ workspacePath, conflicts: [], requestedId: null })
    }
    const conflicts = await listSelfHostedNoteConflicts()
    const current = useSettingStore.getState()
    if (sequence !== refreshSequence || current.primaryBackupMethod !== primaryBackupMethod
      || current.workspacePath !== workspacePath) return
    set(state => ({ workspacePath, conflicts,
      requestedId: conflicts.some(conflict => conflict.id === state.requestedId) ? state.requestedId : null }))
  },
}))
