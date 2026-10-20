import {
  approveMemory as approveMemoryDb,
  archiveMemory as archiveMemoryDb,
  clearAllMemories as clearAllMemoriesDb,
  getAllMemories,
  getMemoryStats,
  permanentlyDeleteMemory as permanentlyDeleteMemoryDb,
  restoreMemory as restoreMemoryDb,
  undoMemoryChange as undoMemoryChangeDb,
  updateMemory as updateMemoryDb,
  upsertMemory,
  type Memory,
  type MemoryUpdateInput,
  type MemoryWriteInput,
} from '@/db/memories'
import {
  getMemoryPolicy,
  updateMemoryPolicy as updateMemoryPolicyDb,
  type MemoryPolicy,
} from '@/db/memory-policy'
import { create } from 'zustand'

interface MemoryStats {
  total: number
  preferences: number
  memories: number
  pending: number
  archived: number
  totalAccessCount: number
}

interface MemoriesState {
  memories: Memory[]
  loading: boolean
  stats: MemoryStats | null
  policy: MemoryPolicy | null

  loadMemories: () => Promise<void>
  loadStats: () => Promise<void>
  loadPolicy: () => Promise<void>
  addMemory: (input: string | MemoryWriteInput, category?: 'preference' | 'memory') => Promise<{
    id: string
    replaced: boolean
    indexingStatus: Memory['indexingStatus']
  }>
  updateMemory: (id: string, updates: MemoryUpdateInput) => Promise<void>
  approveMemory: (id: string) => Promise<void>
  archiveMemory: (id: string) => Promise<void>
  restoreMemory: (id: string) => Promise<void>
  undoMemoryChange: (id: string) => Promise<void>
  permanentlyDeleteMemory: (id: string) => Promise<void>
  clearAllMemories: () => Promise<void>
  updatePolicy: (updates: Partial<MemoryPolicy>) => Promise<void>
}

async function refresh(set: (partial: Partial<MemoriesState>) => void) {
  const [memories, stats, policy] = await Promise.all([
    getAllMemories({ includeInactive: true }),
    getMemoryStats(),
    getMemoryPolicy(),
  ])
  set({ memories, stats, policy })
}

const useMemoriesStore = create<MemoriesState>((set) => ({
  memories: [],
  loading: false,
  stats: null,
  policy: null,

  loadMemories: async () => {
    set({ loading: true })
    try {
      const memories = await getAllMemories({ includeInactive: true })
      set({ memories })
    } catch (error) {
      console.error('Failed to load memories:', error)
    } finally {
      set({ loading: false })
    }
  },

  loadStats: async () => {
    try {
      set({ stats: await getMemoryStats() })
    } catch (error) {
      console.error('Failed to load memory stats:', error)
    }
  },

  loadPolicy: async () => {
    try {
      set({ policy: await getMemoryPolicy() })
    } catch (error) {
      console.error('Failed to load memory policy:', error)
    }
  },

  addMemory: async (input, category) => {
    const result = await upsertMemory(
      typeof input === 'string'
        ? { content: input, category }
        : input
    )
    await refresh(set)
    return result
  },

  updateMemory: async (id, updates) => {
    await updateMemoryDb(id, updates)
    await refresh(set)
  },

  approveMemory: async (id) => {
    await approveMemoryDb(id)
    await refresh(set)
  },

  archiveMemory: async (id) => {
    await archiveMemoryDb(id)
    await refresh(set)
  },

  restoreMemory: async (id) => {
    await restoreMemoryDb(id)
    await refresh(set)
  },

  undoMemoryChange: async (id) => {
    await undoMemoryChangeDb(id)
    await refresh(set)
  },

  permanentlyDeleteMemory: async (id) => {
    await permanentlyDeleteMemoryDb(id)
    await refresh(set)
  },

  clearAllMemories: async () => {
    await clearAllMemoriesDb()
    await refresh(set)
  },

  updatePolicy: async (updates) => {
    const policy = await updateMemoryPolicyDb(updates)
    set({ policy })
  },
}))

export default useMemoriesStore
