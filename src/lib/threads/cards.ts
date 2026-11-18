// Fork（almanac ALMNC-14）：對話訊息裡的內嵌卡片。資料型別與「怎麼顯示」的判斷都是純函式。
// 兩種卡：提案卡（收集頁拆出來的筆記／任務／時段，等你收下）與開工卡結果（P6 才會真的產生，這裡先定型別與佔位）。
// 元件（threads/thread-cards.tsx）只負責把 resolveThreadCard 的結果畫出來，不在元件裡做判斷。
import type { ProposalKind } from '@/lib/collect/types'

export type CardStatus = 'wait' | 'ok' | 'no'

export interface ProposalCardData {
  type: 'proposal'
  id: string
  kind: ProposalKind
  title: string
  /** 一句理由或內文摘要。 */
  detail?: string
  /** YYYY-MM-DD */
  due?: string
  /** HH:mm */
  time?: string
  status: CardStatus
  /** 對應收集頁的提案；有的話「收下」會走收集頁的寫入流程（筆記檔、今日日誌）。 */
  source?: { itemId: string; proposalId: string }
}

export type KickoffState = 'proposed' | 'running' | 'done' | 'cancelled'
export type KickoffTaskStatus = 'wait' | 'run' | 'done'
export type KickoffAcceptStatus = 'open' | 'ok' | 'look'

/**
 * 開工卡結果。P6 還沒做：欄位先照 redesign_v3 的 KICK 定型，之後 P6 可以直接填；
 * `placeholder: true` 表示內容是示範資料，畫面會標「示範」。
 */
export interface KickoffResultCardData {
  type: 'kickoff-result'
  id: string
  title: string
  state: KickoffState
  tasks: Array<{ n: number; text: string; owner?: string; status: KickoffTaskStatus; dependsOn?: number[] }>
  acceptance: Array<{ text: string; status: KickoffAcceptStatus }>
  placeholder?: boolean
}

export type ThreadCard = ProposalCardData | KickoffResultCardData

export type CardAction = 'accept' | 'reject' | 'start' | 'hold' | 'reopen'

export type ProposalTone = 'pending' | 'done' | 'muted'

export interface ProposalCardView {
  type: 'proposal'
  id: string
  kind: ProposalKind
  title: string
  detail: string
  /** 日期與時間合成一句，沒有就空字串。 */
  when: string
  /** i18n key（threads.cards.*）。 */
  statusKey: 'proposalWait' | 'proposalOk' | 'proposalNo'
  tone: ProposalTone
  actions: CardAction[]
}

export interface KickoffCardView {
  type: 'kickoff-result'
  id: string
  title: string
  placeholder: boolean
  stateKey: 'kickoffProposed' | 'kickoffRunning' | 'kickoffDone' | 'kickoffCancelled'
  done: number
  total: number
  /** 還沒開工或先不開時不顯示每件的進度。 */
  showTaskStatus: boolean
  tasks: KickoffResultCardData['tasks']
  acceptance: KickoffResultCardData['acceptance']
  /** 要使用者看一下的驗收條數。 */
  needsLook: number
  actions: CardAction[]
}

export type ThreadCardView = ProposalCardView | KickoffCardView

const PROPOSAL_KINDS = new Set<ProposalKind>(['note', 'task', 'event'])
const STATUSES = new Set<CardStatus>(['wait', 'ok', 'no'])
const KICKOFF_STATES = new Set<KickoffState>(['proposed', 'running', 'done', 'cancelled'])
const TASK_STATUSES = new Set<KickoffTaskStatus>(['wait', 'run', 'done'])
const ACCEPT_STATUSES = new Set<KickoffAcceptStatus>(['open', 'ok', 'look'])

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 「M/D HH:mm」；只有一邊就只顯示那邊，日期格式不對就原樣放。 */
export function formatWhen(due?: string, time?: string): string {
  const m = due?.match(/^\d{4}-(\d{2})-(\d{2})$/)
  const day = due ? (m ? `${Number(m[1])}/${Number(m[2])}` : due) : ''
  return [day, time].filter(Boolean).join(' ')
}

/** 把任意資料（例如訊息附的 JSON）判斷成卡片；不認得的型別或欄位不合就回傳 null，不會丟錯。 */
export function parseThreadCard(raw: unknown): ThreadCard | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const id = str(data.id)
  if (!id) return null

  if (data.type === 'proposal') {
    const title = str(data.title)
    if (!title || !PROPOSAL_KINDS.has(data.kind as ProposalKind)) return null
    const source = data.source as Record<string, unknown> | undefined
    return {
      type: 'proposal',
      id,
      kind: data.kind as ProposalKind,
      title,
      detail: str(data.detail),
      due: str(data.due),
      time: str(data.time),
      status: STATUSES.has(data.status as CardStatus) ? (data.status as CardStatus) : 'wait',
      source: source && str(source.itemId) && str(source.proposalId) ? { itemId: source.itemId as string, proposalId: source.proposalId as string } : undefined,
    }
  }

  if (data.type === 'kickoff-result') {
    const title = str(data.title)
    if (!title || !KICKOFF_STATES.has(data.state as KickoffState)) return null
    const tasks = (Array.isArray(data.tasks) ? data.tasks : []).flatMap((entry, index) => {
      const task = entry as Record<string, unknown> | null
      const text = task && str(task.text)
      if (!task || !text) return []
      return [{
        n: typeof task.n === 'number' ? task.n : index + 1,
        text,
        owner: str(task.owner),
        status: TASK_STATUSES.has(task.status as KickoffTaskStatus) ? (task.status as KickoffTaskStatus) : 'wait',
        dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.filter((n): n is number => typeof n === 'number') : undefined,
      }]
    })
    const acceptance = (Array.isArray(data.acceptance) ? data.acceptance : []).flatMap(entry => {
      const item = entry as Record<string, unknown> | null
      const text = item && str(item.text)
      if (!item || !text) return []
      return [{ text, status: ACCEPT_STATUSES.has(item.status as KickoffAcceptStatus) ? (item.status as KickoffAcceptStatus) : 'open' }]
    })
    return { type: 'kickoff-result', id, title, state: data.state as KickoffState, tasks, acceptance, placeholder: data.placeholder === true }
  }

  return null
}

/** 卡片 → 畫面要的所有判斷（狀態文字、可用的動作、進度）。 */
export function resolveThreadCard(card: ThreadCard): ThreadCardView {
  if (card.type === 'proposal') {
    return {
      type: 'proposal',
      id: card.id,
      kind: card.kind,
      title: card.title,
      detail: card.detail ?? '',
      when: formatWhen(card.due, card.time),
      statusKey: card.status === 'ok' ? 'proposalOk' : card.status === 'no' ? 'proposalNo' : 'proposalWait',
      tone: card.status === 'wait' ? 'pending' : card.status === 'ok' ? 'done' : 'muted',
      actions: card.status === 'wait' ? ['accept', 'reject'] : [],
    }
  }
  const done = card.tasks.filter(task => task.status === 'done').length
  const started = card.state === 'running' || card.state === 'done'
  return {
    type: 'kickoff-result',
    id: card.id,
    title: card.title,
    placeholder: card.placeholder === true,
    stateKey: card.state === 'proposed' ? 'kickoffProposed' : card.state === 'running' ? 'kickoffRunning' : card.state === 'done' ? 'kickoffDone' : 'kickoffCancelled',
    done,
    total: card.tasks.length,
    showTaskStatus: started,
    tasks: card.tasks,
    acceptance: card.acceptance,
    needsLook: card.acceptance.filter(item => item.status === 'look').length,
    actions: card.state === 'proposed' ? ['start', 'hold'] : card.state === 'cancelled' ? ['reopen'] : [],
  }
}

/** 對卡片套用動作後的新卡片；開工卡的 start／hold／reopen 只改狀態（真正派活是 P6）。動作不適用就原樣回傳。 */
export function applyCardAction(card: ThreadCard, action: CardAction): ThreadCard {
  if (card.type === 'proposal') {
    if (card.status !== 'wait') return card
    if (action === 'accept') return { ...card, status: 'ok' }
    if (action === 'reject') return { ...card, status: 'no' }
    return card
  }
  if (card.state === 'proposed' && action === 'start') return { ...card, state: 'running' }
  if (card.state === 'proposed' && action === 'hold') return { ...card, state: 'cancelled' }
  if (card.state === 'cancelled' && action === 'reopen') return { ...card, state: 'proposed' }
  return card
}
