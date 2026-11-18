// Fork（almanac ALMNC-10）：「等你定」的投影。純函式、無 I/O。
// 這裡不存任何狀態：清單項目由各來源「現在」的審核狀態算出來——
//   收集：提案 status 為 wait（stores/collect，保存在 store.json 的 collectItems，是收集自己的狀態）
//   任務中心：status 為 awaiting_review 的任務裡 state 為 pending 的草稿（PR #37，src/lib/agent-tasks）
// 接受或拒絕是回頭改來源的狀態，項目自然從清單消失。
import { proposalNoteContent, proposalTaskLine } from '@/lib/collect/builders'
import { insertLinesInSection } from '@/lib/today/today-model'
import { projectJobDecisions } from '@/lib/jobs/projection'
import type { Job } from '@/lib/jobs/schedule'
import type { Proposal } from '@/lib/collect/types'

export type DecideSource = 'collect' | 'draft' | 'job'
export type DecideKind = 'job' | 'note' | 'task' | 'event' | 'create' | 'update' | 'delete' | 'move' | 'copy' | 'folder'

/** 接受後檔案會多／少哪幾行。context 是變動處上面最近的一行（讓人看出插在哪）。 */
export interface DiffPreview {
  context: string[]
  removed: string[]
  added: string[]
  /** removed／added 超過上限被截掉的行數。 */
  hidden: number
}

export type DecidePreview =
  | { type: 'job', result: string, criterion: string, diff: null }
  | { type: 'journal', section: string, fileMissing: boolean, diff: DiffPreview }
  | { type: 'newNote', diff: DiffPreview }
  | { type: 'file', path: string, targetPath?: string, diff: DiffPreview | null }

export interface DecideItem {
  /** 來源 + 識別，同時是畫面的 React key。 */
  key: string
  source: DecideSource
  kind: DecideKind
  title: string
  /** 來源名稱：收集的原文標題、任務中心的任務標題。 */
  origin: string
  /** 草稿的一句摘要；收集提案沒有。 */
  summary: string
  /** 時段／任務的日期時間（顯示用）。 */
  when: string
  /** 排序用：收集是提案所屬項目的建立時間，草稿是任務進入待審的時間。 */
  at: number
  preview: DecidePreview
  /** 被併進這一項的重複提案（同一件事只列一次；接受或拒絕這一項時一併處理）。 */
  duplicates: DecideRef[]
  ref: DecideRef
}

export type DecideRef =
  | { source: 'job', jobId: string, stepId: string }
  | { source: 'collect', itemId: string, proposalId: string }
  | { source: 'draft', taskId: string, draftId: string }

// 輸入用結構型別，不綁定 store，測試時直接給物件。
export interface CollectItemLike {
  id: string
  createdAt: number
  state: 'reading' | 'ready'
  input: { name?: string, text: string }
  proposals: Array<Proposal & { status: 'wait' | 'ok' | 'no' }>
}

export interface DraftLike {
  id: string
  kind: 'create' | 'update' | 'delete' | 'move' | 'copy' | 'folder'
  path: string
  targetPath?: string
  content?: string
  baseContent: string | null
  summary: string
  state: 'pending' | 'applied' | 'discarded' | 'failed'
}

export interface TaskLike {
  id: string
  title: string
  status: string
  updatedAt: number
  drafts: DraftLike[]
}

/** 今日日誌目前的內容；null 表示還沒讀到（沒有預覽也沒有「已在日誌裡」的去重）。 */
export interface JournalSnapshot {
  before: string
  section: string
  /** 今日日誌還沒建立：接受時會依模板建立。 */
  fileMissing: boolean
  /** YYYY-MM-DD，任務沒有日期時預設今天。 */
  today: string
}

export interface ProjectInput {
  items: CollectItemLike[]
  tasks: TaskLike[]
  journal: JournalSnapshot | null
  jobs?: Job[]
}

export const PREVIEW_MAX_LINES = 8

/** 把 before → after 的差異縮成「變動處上一行＋刪的行＋加的行」；只處理一整段連續的變動。 */
export function previewDiff(before: string, after: string, max = PREVIEW_MAX_LINES): DiffPreview {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  // 結尾換行會多出一個空字串，不算內容
  if (a[a.length - 1] === '') a.pop()
  if (b[b.length - 1] === '') b.pop()
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const removed = a.slice(start, endA)
  const added = b.slice(start, endB)
  return {
    context: start > 0 && (removed.length > 0 || added.length > 0) ? [a[start - 1]] : [],
    removed: removed.slice(0, max),
    added: added.slice(0, max),
    hidden: Math.max(0, removed.length - max) + Math.max(0, added.length - max),
  }
}

/** 接受一條任務或時段提案後，今日日誌會多出哪一行（用的是 acceptProposal 同一套：捕捉軌區塊最後）。 */
export function journalInsertPreview(snapshot: JournalSnapshot, proposal: Proposal): { line: string, diff: DiffPreview } {
  const line = proposalTaskLine(proposal, snapshot.today)
  const after = insertLinesInSection(snapshot.before, [line], snapshot.section)
  return { line, diff: previewDiff(snapshot.before, after) }
}

/** 同一件事的比對鍵：種類、標題、日期、時間（標題不分大小寫與前後空白）。 */
export function sameThingKey(proposal: Proposal): string {
  return [proposal.kind, proposal.title.trim().replace(/\s+/g, ' ').toLowerCase(), proposal.due, proposal.time].join('|')
}

function itemOrigin(item: CollectItemLike): string {
  const first = item.input.text.trim().split('\n')[0] ?? ''
  return item.input.name || Array.from(first).slice(0, 48).join('')
}

function whenOf(proposal: Proposal): string {
  const m = proposal.due.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return [m ? `${Number(m[1])}/${Number(m[2])}` : proposal.due, proposal.time].filter(Boolean).join(' ')
}

function projectCollect(items: CollectItemLike[], journal: JournalSnapshot | null): DecideItem[] {
  const out: DecideItem[] = []
  const seen = new Map<string, DecideItem>()
  for (const item of items) {
    if (item.state !== 'ready') continue
    for (const proposal of item.proposals) {
      if (proposal.status !== 'wait') continue
      const ref: DecideRef = { source: 'collect', itemId: item.id, proposalId: proposal.id }
      // 去重一：同一件事已經在今日日誌裡（例如其他管道寫過了），不再問第二次。
      if (journal && proposal.kind !== 'note' && journal.before.split(/\r?\n/).includes(proposalTaskLine(proposal, journal.today))) continue
      // 去重二：兩個來源各提了同一件事，只列一次。
      const same = seen.get(sameThingKey(proposal))
      if (same) { same.duplicates.push(ref); continue }

      let preview: DecidePreview
      if (proposal.kind === 'note') {
        preview = { type: 'newNote', diff: previewDiff('', proposalNoteContent(proposal)) }
      } else if (journal) {
        preview = { type: 'journal', section: journal.section, fileMissing: journal.fileMissing, diff: journalInsertPreview(journal, proposal).diff }
      } else {
        preview = { type: 'journal', section: '', fileMissing: false, diff: { context: [], removed: [], added: [], hidden: 0 } }
      }
      const entry: DecideItem = {
        key: `collect:${item.id}:${proposal.id}`,
        source: 'collect',
        kind: proposal.kind,
        title: proposal.title,
        origin: itemOrigin(item),
        summary: '',
        when: whenOf(proposal),
        at: item.createdAt,
        preview,
        duplicates: [],
        ref,
      }
      seen.set(sameThingKey(proposal), entry)
      out.push(entry)
    }
  }
  return out
}

function projectDrafts(tasks: TaskLike[]): DecideItem[] {
  const out: DecideItem[] = []
  for (const task of tasks) {
    if (task.status !== 'awaiting_review') continue
    for (const draft of task.drafts) {
      if (draft.state !== 'pending') continue
      const diff = draft.kind === 'create' || draft.kind === 'update'
        ? previewDiff(draft.baseContent ?? '', draft.content ?? '')
        : null
      out.push({
        key: `draft:${task.id}:${draft.id}`,
        source: 'draft',
        kind: draft.kind,
        title: draft.path,
        origin: task.title,
        summary: draft.summary,
        when: '',
        at: task.updatedAt,
        preview: { type: 'file', path: draft.path, targetPath: draft.targetPath, diff },
        duplicates: [],
        ref: { source: 'draft', taskId: task.id, draftId: draft.id },
      })
    }
  }
  return out
}

/** 等你定清單：兩個來源合併，等得最久的在最上面；同時間維持來源內的原順序。 */
export function projectDecisions(input: ProjectInput): DecideItem[] {
  const all = [...projectCollect(input.items, input.journal), ...projectDrafts(input.tasks), ...projectJobDecisions(input.jobs ?? [])]
  return all
    .map((item, index) => ({ item, index }))
    .sort((x, y) => x.item.at - y.item.at || x.index - y.index)
    .map(entry => entry.item)
}
