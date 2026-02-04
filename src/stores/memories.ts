import { create } from 'zustand'
import { Memory, getAllMemories, deleteMemory as deleteMemoryDb, upsertMemory, getMemoryStats } from '@/db/memories'
import { fetchEmbedding } from '@/lib/ai/embedding'

interface MemoriesState {
  memories: Memory[]
  loading: boolean
  stats: {
    total: number
    preferences: number
    memories: number
    totalAccessCount: number
  } | null

  // Actions
  loadMemories: () => Promise<void>
  loadStats: () => Promise<void>
  addMemory: (content: string, category?: 'preference' | 'memory') => Promise<{ id: string; replaced: boolean }>
  deleteMemory: (id: string) => Promise<void>
  clearAllMemories: () => Promise<void>
}

const useMemoriesStore = create<MemoriesState>((set, get) => ({
  memories: [],
  loading: false,
  stats: null,

  loadMemories: async () => {
    set({ loading: true })
    try {
      const memories = await getAllMemories()
      set({ memories, loading: false })
    } catch (error) {
      console.error('Failed to load memories:', error)
      set({ loading: false })
    }
  },

  loadStats: async () => {
    try {
      const stats = await getMemoryStats()
      set({ stats })
    } catch (error) {
      console.error('Failed to load memory stats:', error)
    }
  },

  addMemory: async (content, category) => {
    const embedding = await fetchEmbedding(content)
    if (!embedding) {
      throw new Error('无法生成向量嵌入，请检查嵌入模型配置')
    }

    const result = await upsertMemory({
      content,
      embedding: JSON.stringify(embedding),
      category,
    })

    // Reload memories and stats
    await get().loadMemories()
    await get().loadStats()

    return result
  },

  deleteMemory: async (id) => {
    await deleteMemoryDb(id)
    await get().loadMemories()
    await get().loadStats()
  },

  clearAllMemories: async () => {
    const { clearAllMemories: clearDb } = await import('@/db/memories')
    await clearDb()
    await get().loadMemories()
    await get().loadStats()
  },
}))

export default useMemoriesStore
