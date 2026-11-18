// Fork（almanac ALMNC-8）：把一次輸入拆成多個提案。
// 兩條路：AI 拆（parseAiProposals 驗證模型回傳的 JSON），AI 不能用或沒結果就退回規則（splitByRules）。
// 全部是純函式，AI 以參數注入。
import { classifyUnifiedRecordInput } from '@/lib/unified-record-input'
import { parseTime, resolveDate } from '@/lib/daily/nl-task'
import type { AskModel, CollectInput, Proposal, ProposalKind, SplitResult } from './types'

export const MAX_PROPOSALS = 8
const MAX_TITLE = 120
/** 單行、這麼短又帶日期或時間，視為「一句待辦」。 */
const SHORT_TASK_MAX = 40

let counter = 0
export function newProposalId(): string {
  counter += 1
  return `p${Date.now().toString(36)}${counter}`
}

function makeProposal(partial: Partial<Proposal> & Pick<Proposal, 'kind' | 'title'>): Proposal {
  return { id: newProposalId(), body: '', due: '', time: '', tags: [], ...partial }
}

// ---------- 自然語言的日期與時間 ----------

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function cnNumber(text: string): number | null {
  if (text === '十') return 10
  if (text.length === 1) return CN_DIGITS[text] ?? null
  if (text.length === 2 && text[0] === '十') return CN_DIGITS[text[1]] ? 10 + CN_DIGITS[text[1]] : null
  return null
}

/** 「下午三點」→「下午3點」，讓 parseTime 認得。 */
function digitizeHours(text: string): string {
  return text.replace(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?([一二兩三四五六七八九十]{1,2})([點点])/g, (whole, period: string | undefined, num: string, mark: string) => {
    // 「一點」常是「一點點」的意思（有一點想法），沒有上午、下午等時段詞就不當成一點鐘
    if (num === '一' && !period) return whole
    const value = cnNumber(num)
    return value === null ? whole : `${period ?? ''}${value}${mark}`
  })
}

const DATE_TOKEN = /今天|今日|明天|明日|後天|后天|大後天|大后天|(?:下)*(?:週|周|星期|禮拜|礼拜)[一二三四五六日天]|\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}[號号日]?|\d{1,2}\/\d{1,2}/
const TIME_TOKEN = /(?:凌晨|早上|上午|中午|下午|傍晚|晚上)?\d{1,2}[點点](?:半|\d{1,2}分?)?|\b\d{1,2}:\d{2}\b/

export interface ExtractedSchedule {
  title: string
  due: string
  time: string
}

/** 從一句話裡找日期與時間，回傳去掉它們之後的標題。只有時間沒有日期時，日期是今天。 */
export function extractSchedule(sentence: string, now: Date): ExtractedSchedule {
  const text = digitizeHours(sentence.trim())
  let rest = text
  let due = ''
  let time = ''

  const dateMatch = rest.match(DATE_TOKEN)
  if (dateMatch) {
    const resolved = resolveDate(dateMatch[0], now)
    if (resolved) {
      due = resolved
      rest = rest.replace(dateMatch[0], ' ')
    }
  }
  const timeMatch = rest.match(TIME_TOKEN)
  if (timeMatch) {
    let resolved = parseTime(timeMatch[0])
    if (resolved) {
      // 沒說上午下午的「三點」，1 到 7 點一律當下午（沒人排凌晨三點的會）
      const bare = /^\d{1,2}[點点]/.test(timeMatch[0])
      const hour = Number(resolved.slice(0, 2))
      if (bare && hour >= 1 && hour <= 7) resolved = `${String(hour + 12).padStart(2, '0')}${resolved.slice(2)}`
      time = resolved
      // 「三點前交」的「前」是期限語氣，跟著時間一起拿掉
      const at = rest.indexOf(timeMatch[0])
      const tail = rest.slice(at + timeMatch[0].length).replace(/^(?:之前|前)/, '')
      rest = `${rest.slice(0, at)} ${tail}`
    }
  }
  if (time && !due) due = ymd(now)

  const title = rest.replace(/\s+/g, ' ').replace(/^[，,、:：\s]+|[，,、:：\s]+$/g, '').replace(/^前/, '').trim()
  return { title: title || sentence.trim(), due, time }
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// ---------- 規則拆分 ----------

const CHECKBOX_LINE = /^\s*[-*+]\s+\[ \]\s+(.+)$/
const TODO_PREFIX = /^\s*(?:待辦|TODO|todo|任務)\s*[:：]\s*(.+)$/

function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.replace(/^www\./, '')
  } catch {
    return url.trim()
  }
}

function firstLineTitle(text: string, limit = 24): string {
  const first = text.trim().split('\n')[0]?.replace(/^#+\s*/, '').trim() ?? ''
  return Array.from(first).slice(0, limit).join('')
}

/** 排程提案：一句話帶時間 → 時段，只帶日期 → 任務。 */
function scheduledProposal(sentence: string, now: Date): Proposal {
  const schedule = extractSchedule(sentence, now)
  return makeProposal({ kind: schedule.time ? 'event' : 'task', title: schedule.title, due: schedule.due, time: schedule.time })
}

/**
 * 沒有 AI 時的拆分，保守：
 * - 連結 → 一則筆記；
 * - 一句短話又帶日期或時間 → 任務（有時間就是時段）；
 * - 其他 → 一則筆記，外加文字裡明確寫成「- [ ] …」或「待辦：…」的行各一個任務。
 */
export function splitByRules(input: CollectInput, now: Date): Proposal[] {
  const text = input.text.trim()
  if (input.kind === 'image' || input.kind === 'file') {
    const label = input.name?.trim() || (input.kind === 'image' ? 'image' : 'file')
    return [makeProposal({ kind: 'note', title: label, body: text })]
  }
  if (!text) return []

  if (classifyUnifiedRecordInput(text) === 'link') {
    return [makeProposal({ kind: 'note', title: hostOf(text), body: `[${text}](${text})` })]
  }

  const lines = text.split(/\r?\n/)
  const single = lines.length === 1 && Array.from(text).length <= SHORT_TASK_MAX
  if (single && !CHECKBOX_LINE.test(text)) {
    const schedule = extractSchedule(text, now)
    if (schedule.due || schedule.time) return [scheduledProposal(text, now)]
  }

  const proposals: Proposal[] = [makeProposal({ kind: 'note', title: firstLineTitle(text) || text.slice(0, 24), body: text })]
  for (const line of lines) {
    const found = line.match(CHECKBOX_LINE) ?? line.match(TODO_PREFIX)
    if (!found || proposals.length >= MAX_PROPOSALS) continue
    const sentence = found[1].trim()
    if (!sentence) continue
    const schedule = extractSchedule(sentence, now)
    proposals.push(makeProposal({ kind: schedule.time ? 'event' : 'task', title: schedule.title, due: schedule.due, time: schedule.time }))
  }
  return proposals
}

// ---------- AI 拆分 ----------

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function buildSplitPrompt(input: CollectInput, now: Date): string {
  const today = `${ymd(now)}（週${WEEKDAYS[now.getDay()]}）`
  const source = input.kind === 'image' ? `一張圖片${input.name ? `（${input.name}）` : ''}` : input.kind === 'file' ? `一個檔案：${input.name ?? ''}` : input.kind === 'link' ? '一個連結' : '一段文字'
  return [
    `你是筆記整理員。使用者收集了${source}，把它拆成幾個「提案」，使用者會逐條決定收不收。`,
    `今天是 ${today}。`,
    '提案有三種 kind：',
    '- note：值得留下的筆記。title 是簡短標題，body 是整理後的內文（Markdown）。',
    '- task：要做的事。title 是動詞開頭的一句話；有期限才填 due（YYYY-MM-DD）。',
    '- event：有明確時間的時段（開會、約定）。一定要有 due（YYYY-MM-DD）與 time（HH:mm，24 小時制）。',
    `最多 ${MAX_PROPOSALS} 個，不要編造內容裡沒有的事；沒有任務或時段就只給一則筆記。tags 是不含 # 的短詞，可省略。`,
    '只輸出 JSON，不要任何說明或程式碼框：{"proposals":[{"kind":"note|task|event","title":"","body":"","due":"","time":"","tags":[]}]}',
    '---',
    input.text.trim() || '（沒有文字，請看附圖）',
  ].join('\n')
}

function isValidYmd(value: string): boolean {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

function normalizeTime(value: string): string {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return ''
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.search(/[{[]/)
  if (start < 0) return null
  const open = cleaned[start]
  const end = cleaned.lastIndexOf(open === '{' ? '}' : ']')
  if (end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * 把模型回傳的文字解析成提案。寬鬆接受 {proposals:[…]} 或直接陣列、程式碼框、<think>；
 * 嚴格驗證每一條：kind 要認得、title 不能空、日期時間格式要對。event 缺日期或時間就降成 task，task 的日期不合法就清掉。
 * 解析不出任何提案時回傳空陣列（呼叫端退回規則拆分）。
 */
export function parseAiProposals(raw: string): Proposal[] {
  const parsed = extractJson(raw)
  const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { proposals?: unknown } | null)?.proposals
  if (!Array.isArray(list)) return []

  const proposals: Proposal[] = []
  for (const item of list) {
    if (proposals.length >= MAX_PROPOSALS) break
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const kind = asString(record.kind).toLowerCase()
    if (kind !== 'note' && kind !== 'task' && kind !== 'event') continue
    const title = Array.from(asString(record.title)).slice(0, MAX_TITLE).join('')
    if (!title) continue

    let due = asString(record.due)
    if (!isValidYmd(due)) due = ''
    const time = normalizeTime(asString(record.time))
    const tags = (Array.isArray(record.tags) ? record.tags : [])
      .map(tag => asString(tag).replace(/^#/, ''))
      .filter(tag => /^[\p{L}\p{N}_/-]+$/u.test(tag))
      .slice(0, 5)

    let finalKind: ProposalKind = kind
    if (kind === 'event' && !(due && time)) finalKind = 'task'
    proposals.push(makeProposal({
      kind: finalKind,
      title,
      body: finalKind === 'note' ? asString(record.body) : '',
      due: finalKind === 'note' ? '' : due,
      time: finalKind === 'event' ? time : '',
      tags: [...new Set(tags)],
    }))
  }
  return proposals
}

/** 主入口：先問模型，失敗、逾時或沒有可用提案就退回規則拆分。 */
export async function splitInput(input: CollectInput, now: Date, ask?: AskModel): Promise<SplitResult> {
  if (ask) {
    try {
      const raw = await ask(buildSplitPrompt(input, now), input.imageDataUrl)
      const proposals = parseAiProposals(raw)
      if (proposals.length > 0) return { proposals, source: 'ai' }
    } catch {
      // AI 沒設定或呼叫失敗：用規則
    }
  }
  return { proposals: splitByRules(input, now), source: 'rules' }
}
