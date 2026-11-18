// Fork（almanac ALMNC-14）：對話頁的狀態。做法同收集頁、Inbox 頁：同一時間只開一個全頁覆蓋層。
// 對話本身（列表、目前對話、訊息）仍在 useChatStore，這裡只管頁面開關、專案分組、搜尋，與訊息內嵌卡片。
import { create } from 'zustand'
import { applyCardAction, type CardAction, type ThreadCard } from '@/lib/threads/cards'
import {
  assignProject, dropProject, loadProjectMap, renameProject, saveProjectMap, type ThreadGroupMode, type ThreadProjectMap,
} from '@/lib/threads/projects'
import useCollectStore from './collect'
import useHomeStore from './home'
import useInboxStore from './inbox'
import usePromptLibraryStore from './prompt-library'

interface ThreadsState {
  visible: boolean
  show: () => void
  hide: () => void

  projectMap: ThreadProjectMap
  projectsLoaded: boolean
  loadProjects: () => Promise<void>
  moveToProject: (threadKey: string, project: string) => Promise<void>
  renameProject: (from: string, to: string) => Promise<void>
  removeProject: (project: string) => Promise<void>

  mode: ThreadGroupMode
  setMode: (mode: ThreadGroupMode) => void
  query: string
  setQuery: (query: string) => void

  /** 對話頁放對話面板的位置；有值時，右側欄的對話面板會搬過來（chat-dock.tsx）。 */
  chatHost: HTMLElement | null
  setChatHost: (host: HTMLElement | null) => void

  /** chatId → 掛在那則訊息下面的卡片。只放記憶體：提案本身（收集頁）也還沒持久化。 */
  cards: Record<number, ThreadCard[]>
  attachCard: (chatId: number, card: ThreadCard) => void
  actOnCard: (chatId: number, cardId: string, action: CardAction) => Promise<void>
}

const useThreadsStore = create<ThreadsState>((set, get) => {
  async function persist(next: ThreadProjectMap) {
    set({ projectMap: next })
    await saveProjectMap(next)
  }
  return {
    visible: false,
    show: () => {
      useHomeStore.getState().hide()
      useInboxStore.getState().hide()
      usePromptLibraryStore.getState().hide()
      useCollectStore.getState().hide()
      set({ visible: true })
    },
    hide: () => set({ visible: false }),

    projectMap: {},
    projectsLoaded: false,
    loadProjects: async () => {
      if (get().projectsLoaded) return
      const map = await loadProjectMap()
      // 載入期間使用者可能已經移動過對話：以已有的為準
      set(state => ({ projectMap: { ...map, ...state.projectMap }, projectsLoaded: true }))
    },
    moveToProject: async (key, project) => persist(assignProject(get().projectMap, key, project)),
    renameProject: async (from, to) => persist(renameProject(get().projectMap, from, to)),
    removeProject: async project => persist(dropProject(get().projectMap, project)),

    mode: 'project',
    setMode: mode => set({ mode }),
    query: '',
    setQuery: query => set({ query }),

    chatHost: null,
    setChatHost: chatHost => set({ chatHost }),

    cards: {},
    attachCard: (chatId, card) => set(state => ({
      cards: { ...state.cards, [chatId]: [...(state.cards[chatId] ?? []).filter(entry => entry.id !== card.id), card] },
    })),
    actOnCard: async (chatId, cardId, action) => {
      const card = get().cards[chatId]?.find(entry => entry.id === cardId)
      if (!card) return
      // 提案卡連著收集頁的提案時，收下／不要走收集頁的流程（會寫筆記檔或今日日誌）。
      if (card.type === 'proposal' && card.source) {
        const collect = useCollectStore.getState()
        if (action === 'accept') await collect.accept(card.source.itemId, card.source.proposalId)
        if (action === 'reject') collect.reject(card.source.itemId, card.source.proposalId)
      }
      const next = applyCardAction(card, action)
      if (next === card) return
      set(state => ({ cards: { ...state.cards, [chatId]: (state.cards[chatId] ?? []).map(entry => entry.id === cardId ? next : entry) } }))
    },
  }
})

export default useThreadsStore
