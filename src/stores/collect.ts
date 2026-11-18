// Fork（almanac ALMNC-8）：收集頁的狀態。做法同 Inbox、提示詞庫頁：同一時間只開一個全頁覆蓋層。
// 收集項目與提案只放記憶體（還沒收下的提案關掉頁面就會消失）；收下的東西寫進筆記檔與今日日誌，不另開資料表。
import { create } from 'zustand'
import { askCollectModel } from '@/lib/collect/ai'
import { splitInput } from '@/lib/collect/split'
import { acceptProposal, undoAccepted, type AcceptResult } from '@/lib/collect/write'
import type { CollectInput, Proposal, SplitSource } from '@/lib/collect/types'
import { setRecordsProcessed } from '@/lib/inbox/actions'
import { useUiModeStore } from '@/lib/fork-ui'
import useDailySettingsStore from './daily-settings'
import useHomeStore from './home'
import useInboxStore from './inbox'
import usePromptLibraryStore from './prompt-library'

export type ProposalStatus = 'wait' | 'ok' | 'no'

export interface CaptureProposal extends Proposal {
  status: ProposalStatus
  result?: AcceptResult
}

export interface CaptureItem {
  id: string
  input: CollectInput
  createdAt: number
  state: 'reading' | 'ready'
  source?: SplitSource
  proposals: CaptureProposal[]
  /** 從 Inbox 拆進來的既有記錄；提案處理完時把它標成已整理。 */
  recordId?: number
}

interface CollectState {
  visible: boolean
  items: CaptureItem[]
  show: () => void
  hide: () => void
  submit: (input: CollectInput, options?: { recordId?: number }) => Promise<void>
  accept: (itemId: string, proposalId: string) => Promise<AcceptResult>
  reject: (itemId: string, proposalId: string) => void
  edit: (itemId: string, proposalId: string, patch: Partial<Pick<Proposal, 'title' | 'due' | 'time'>>) => void
  undo: (itemId: string, proposalId: string) => Promise<boolean>
  remove: (itemId: string) => void
}

let itemCounter = 0

function patchProposal(items: CaptureItem[], itemId: string, proposalId: string, patch: Partial<CaptureProposal>): CaptureItem[] {
  return items.map(item => item.id !== itemId ? item : {
    ...item,
    proposals: item.proposals.map(proposal => proposal.id === proposalId ? { ...proposal, ...patch } : proposal),
  })
}

const useCollectStore = create<CollectState>((set, get) => ({
  visible: false,
  items: [],
  show: () => {
    useHomeStore.getState().hide()
    useInboxStore.getState().hide()
    usePromptLibraryStore.getState().hide()
    set({ visible: true })
  },
  hide: () => set({ visible: false }),

  submit: async (input, options) => {
    itemCounter += 1
    const id = `capture-${Date.now().toString(36)}-${itemCounter}`
    set(state => ({ items: [{ id, input, createdAt: Date.now(), state: 'reading', proposals: [], recordId: options?.recordId }, ...state.items] }))
    const { proposals, source } = await splitInput(input, new Date(), askCollectModel)
    set(state => ({
      items: state.items.map(item => item.id === id
        ? { ...item, state: 'ready', source, proposals: proposals.map(proposal => ({ ...proposal, status: 'wait' as const })) }
        : item),
    }))
  },

  accept: async (itemId, proposalId) => {
    const item = get().items.find(entry => entry.id === itemId)
    const proposal = item?.proposals.find(entry => entry.id === proposalId)
    if (!item || !proposal || proposal.status !== 'wait') throw new Error('proposal not found')
    await useDailySettingsStore.getState().initSettings()
    const result = await acceptProposal(proposal, { noteFolder: useDailySettingsStore.getState().inboxFolder })
    set(state => ({ items: patchProposal(state.items, itemId, proposalId, { status: 'ok', result }) }))
    const updated = get().items.find(entry => entry.id === itemId)
    if (updated?.recordId !== undefined && updated.proposals.every(entry => entry.status !== 'wait')) {
      const note = updated.proposals.find(entry => entry.status === 'ok' && entry.kind === 'note')
      await setRecordsProcessed([updated.recordId], note?.result?.path ?? null).catch(error => console.error('[collect] mark record processed failed:', error))
    }
    return result
  },

  reject: (itemId, proposalId) => set(state => ({ items: patchProposal(state.items, itemId, proposalId, { status: 'no' }) })),

  edit: (itemId, proposalId, patch) => set(state => ({ items: patchProposal(state.items, itemId, proposalId, patch) })),

  undo: async (itemId, proposalId) => {
    const proposal = get().items.find(entry => entry.id === itemId)?.proposals.find(entry => entry.id === proposalId)
    if (!proposal?.result) return false
    const undone = await undoAccepted(proposal.result)
    if (undone) set(state => ({ items: patchProposal(state.items, itemId, proposalId, { status: 'wait', result: undefined }) }))
    return undone
  },

  remove: itemId => set(state => ({ items: state.items.filter(item => item.id !== itemId) })),
}))

// 其他全頁覆蓋層打開時收起收集頁；切回舊介面時也收起。
useHomeStore.subscribe((state, previous) => {
  if (state.visible && !previous.visible) useCollectStore.getState().hide()
})
useInboxStore.subscribe((state, previous) => {
  if (state.visible && !previous.visible) useCollectStore.getState().hide()
})
usePromptLibraryStore.subscribe((state, previous) => {
  if (state.visible && !previous.visible) useCollectStore.getState().hide()
})
useUiModeStore.subscribe((state) => {
  if (state.mode !== 'v3') useCollectStore.getState().hide()
})

export default useCollectStore
