// Fork（almanac ALMNC-23）：今天主畫面頂端的日期列。純函式、無 I/O；今天由參數注入。
// 一次顯示 STRIP_DAYS 天（約兩週）；窗口起點與「選中日」分開，點日期不會讓整排跳動，翻頁每次一週。
import { toDateKey } from '@/lib/daily/format'

export const STRIP_DAYS = 14
export const STRIP_PAGE_DAYS = 7
/** 預設窗口：今天（或選中日）前面留幾天。 */
export const STRIP_LEAD_DAYS = 3

export interface DateStripDay {
  /** YYYY-MM-DD */
  key: string
  date: Date
  day: number
  /** 0 = 週日 … 6 = 週六 */
  weekday: number
  isToday: boolean
  isSelected: boolean
  hasNote: boolean
  /** 每月 1 日：用來在列上標出換月。 */
  firstOfMonth: boolean
}

export function addDaysLocal(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export function dateFromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 窗口預設起點：讓 anchor 落在前段（前面留 STRIP_LEAD_DAYS 天）。 */
export function defaultStripStart(anchor: Date): Date {
  return addDaysLocal(anchor, -STRIP_LEAD_DAYS)
}

/** 翻頁：direction -1 往前一週、1 往後一週。 */
export function shiftStripStart(start: Date, direction: -1 | 1): Date {
  return addDaysLocal(start, direction * STRIP_PAGE_DAYS)
}

/** target 不在窗口內時，移動窗口剛好讓它露出來（在哪一端就靠哪一端）。 */
export function ensureStripVisible(start: Date, target: Date, count = STRIP_DAYS): Date {
  const targetKey = toDateKey(target)
  if (targetKey < toDateKey(start)) return new Date(target.getFullYear(), target.getMonth(), target.getDate())
  if (targetKey > toDateKey(addDaysLocal(start, count - 1))) return addDaysLocal(target, -(count - 1))
  return start
}

export function buildDateStrip(input: {
  start: Date
  /** 選中日的 YYYY-MM-DD */
  selectedKey: string
  todayKey: string
  /** 有日記的日期（`dailyNoteDateKeys` 的結果） */
  noteKeys: ReadonlySet<string>
  count?: number
}): DateStripDay[] {
  const { start, selectedKey, todayKey, noteKeys, count = STRIP_DAYS } = input
  return Array.from({ length: count }, (_, offset) => {
    const date = addDaysLocal(start, offset)
    const key = toDateKey(date)
    return {
      key,
      date,
      day: date.getDate(),
      weekday: date.getDay(),
      isToday: key === todayKey,
      isSelected: key === selectedKey,
      hasNote: noteKeys.has(key),
      firstOfMonth: date.getDate() === 1,
    }
  })
}
