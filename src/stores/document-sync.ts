import { create } from 'zustand'

import type { SyncPlatform } from '@/types/sync'

export type DocumentSyncPhase = 'idle' | 'checking' | 'syncing' | 'update-available' | 'conflict' | 'error'

export interface DocumentSyncController {
  owner: string
  path: string
  workspacePath: string
  provider: SyncPlatform
  busy: boolean
  phase: DocumentSyncPhase
  sync: () => Promise<void>
  push: () => Promise<void>
  pull: () => Promise<void>
  resolveConflict: () => void
}

interface DocumentSyncState {
  document: DocumentSyncController | null
  register: (document: DocumentSyncController) => void
  unregister: (owner: string) => void
}

export const useDocumentSyncStore = create<DocumentSyncState>((set) => ({
  document: null,
  register: document => set({ document }),
  unregister: owner => set(state => state.document?.owner === owner ? { document: null } : state),
}))
