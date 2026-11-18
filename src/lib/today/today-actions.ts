/**
 * D2 今日頁的寫回動作。每個動作都回傳 WriteRecord，讓畫面能「復原」。
 * 寫回前一律確認目標行還是索引裡看到的那一行，避免檔案在別處改過時寫錯行。
 */

import { parseNaturalTask, type NaturalTask } from '@/lib/daily/nl-task'
import { completeTaskInContent } from '@/lib/daily/recurrence'
import { toggleTaskInContent } from '@/lib/daily/tasks'
import { stamp, type StampKind } from '@/lib/daily/daily-note'
import { dailyNotePath } from '@/lib/daily/format'
import { ensureDailyNote } from '@/lib/daily/open-daily-note'
import { readNote } from '@/lib/daily/note-io'
import { commitNoteWrites, NoteWriteConflict, revertNoteWrites } from '@/lib/daily/coordinated-write'
import { NoteRewriteConflictError } from '@/lib/note-rewrite'
import type { TaskRef } from '@/lib/vault-index/index-core'
import useDailySettingsStore from '@/stores/daily-settings'
import { carryTasks, dateKey, insertLinesInSection, openTaskLines } from './today-model'
import { setTaskSchedule } from './schedule'

export interface WriteRecord {
  writes: Array<{ path: string, before: string, after: string }>
  /** D5：完成 🔁 任務後，下一次的到期日（沒有日期時為空字串） */
  nextDue?: string
}

/** D4 快速新增寫入今日筆記的這個區塊；找不到時附在檔尾。 */
export const QUICK_ADD_SECTION = '捕捉軌'

const DUE_IN_LINE_RE = /(?:📅️?\s*|due::\s*)(\d{4}-\d{2}-\d{2})/u

export class StaleTaskError extends Error {
  constructor(public path: string) {
    super(`Task line changed on disk: ${path}`)
  }
}

type Rebase = ((latest: string) => string | null) | undefined

/**
 * Fork（almanac ALMNC-21）：寫入經編輯器協調（note-rewrite）。最新內容與讀到的不同時，用 rebase
 * 把同一動作套到最新內容；套不上或編輯器正忙就丟 StaleTaskError，不覆蓋任何內容。
 */
async function applyWrites<T extends WriteRecord>(record: T, rebases: Rebase[] = []): Promise<T> {
  try {
    const writes = await commitNoteWrites(record.writes.map((write, i) => ({ ...write, rebase: rebases[i] })))
    return { ...record, writes }
  } catch (error) {
    if (error instanceof NoteWriteConflict || error instanceof NoteRewriteConflictError) throw new StaleTaskError(error.path)
    throw error
  }
}

/** 在最新內容上找回同一行任務；行號不變且原文相同才算。 */
function rebaseOnTask(task: TaskRef, edit: (content: string, lines: string[]) => string | null): (latest: string) => string | null {
  return latest => {
    const lines = latest.split('\n')
    if (lines[task.line]?.replace(/\r$/, '') !== task.raw) return null
    return edit(latest, lines)
  }
}

/** 讀出任務所在的檔案，確認那一行還是索引裡看到的樣子。 */
async function readTaskSource(task: TaskRef): Promise<{ before: string, lines: string[] }> {
  const before = await readNote(task.path)
  if (before === null) throw new StaleTaskError(task.path)
  const lines = before.split('\n')
  if (lines[task.line]?.replace(/\r$/, '') !== task.raw) throw new StaleTaskError(task.path)
  return { before, lines }
}

/** 勾選或取消勾選。未完成且帶 🔁 的任務完成時，下一行會產生下一次。 */
export async function setTaskChecked(task: TaskRef, checked: boolean, now: Date = new Date()): Promise<WriteRecord> {
  const { before } = await readTaskSource(task)
  const edit = (content: string) => checked && !task.done
    ? completeTaskInContent(content, task.line, now)
    : checked === task.done
      ? content
      : toggleTaskInContent(content, task.line, { today: now })
  const after = edit(before)
  if (after === null) throw new StaleTaskError(task.path)
  if (after === before) return { writes: [] }
  const record = await applyWrites({ writes: [{ path: task.path, before, after }] } as WriteRecord, [rebaseOnTask(task, content => edit(content))])
  if (checked && !task.done && task.recurrence) {
    const written = record.writes[0]?.after ?? after
    const nextLine = written.split('\n')[task.line + 1] ?? ''
    record.nextDue = nextLine.match(DUE_IN_LINE_RE)?.[1] ?? ''
  }
  return record
}

/** D8：把任務排到今天的某個時間，到期日一併改成今天；time 為空字串時只取消時間。 */
export async function scheduleTask(task: TaskRef, time: string, now: Date = new Date()): Promise<WriteRecord> {
  const { before } = await readTaskSource(task)
  // 取消時間時不動到期日；排上時間代表排在今天
  const edit = (_content: string, lines: string[]) => {
    const updated = setTaskSchedule(lines[task.line], { due: time ? dateKey(now) : task.due || dateKey(now), time })
    if (updated === null) return null
    const next = [...lines]
    next[task.line] = updated
    return next.join('\n')
  }
  const after = edit(before, before.split('\n'))
  if (after === null) throw new StaleTaskError(task.path)
  if (after === before) return { writes: [] }
  return applyWrites({ writes: [{ path: task.path, before, after }] }, [rebaseOnTask(task, edit)])
}

/** D4：把一行自然語言轉成 Obsidian Tasks 任務，寫進今日筆記的捕捉區塊。 */
export async function quickAddTask(input: string, now: Date = new Date()): Promise<WriteRecord & { task: NaturalTask }> {
  const task = parseNaturalTask(input, now)
  if (!task.title) return { writes: [], task }
  const { path } = await ensureDailyNote(now)
  const before = await readNote(path) ?? ''
  const insert = (content: string) => insertLinesInSection(content, [task.line], QUICK_ADD_SECTION)
  return applyWrites({ writes: [{ path, before, after: insert(before) }], task }, [insert])
}

/** 復原：只有在檔案仍是我們寫入的內容時才還原，避免蓋掉之後的編輯。 */
export async function undoWrites(record: WriteRecord): Promise<boolean> {
  // Fork（ALMNC-21）：經編輯器協調；檔案（或編輯器裡的內容）已不是我們寫入的就不還原
  return revertNoteWrites(record.writes)
}

/** 早晨啟動／整日復盤：在今日筆記寫入 `morning:: done`／`reviewed:: done`。 */
export async function stampToday(kind: StampKind, now: Date = new Date()): Promise<WriteRecord> {
  const { path } = await ensureDailyNote(now)
  const before = await readNote(path) ?? ''
  const result = stamp(before, kind)
  if (!result.changed) return { writes: [] }
  return applyWrites({ writes: [{ path, before, after: result.content }] }, [latest => {
    const again = stamp(latest, kind)
    return again.changed ? again.content : latest
  }])
}

function yesterdayOf(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
}

/** 昨天的日記裡還沒完成的任務數；沒有昨天的日記時為 0。 */
export async function countCarryable(now: Date = new Date()): Promise<number> {
  await useDailySettingsStore.getState().initSettings()
  const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
  const content = await readNote(dailyNotePath(yesterdayOf(now), dailyFolder, dailyPattern))
  return content === null ? 0 : openTaskLines(content).length
}

/** D6：把昨天日記的未完成任務移到今日筆記，原處留下 `→ [[今天]]`。 */
export async function carryYesterdayTasks(now: Date = new Date()): Promise<WriteRecord & { moved: number }> {
  await useDailySettingsStore.getState().initSettings()
  const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
  const sourcePath = dailyNotePath(yesterdayOf(now), dailyFolder, dailyPattern)
  const source = await readNote(sourcePath)
  if (source === null) return { writes: [], moved: 0 }

  const { path: targetPath } = await ensureDailyNote(now)
  const target = await readNote(targetPath) ?? ''
  const targetNoteName = targetPath.split('/').pop()!.replace(/\.md$/i, '')
  const result = carryTasks({ source, target, lines: openTaskLines(source), targetNoteName })
  if (result.moved === 0) return { writes: [], moved: 0 }

  // 先寫今天再改昨天：中途失敗時任務最多重複，不會遺失
  const record = await applyWrites({
    writes: [
      { path: targetPath, before: target, after: result.target },
      { path: sourcePath, before: source, after: result.source },
    ],
  })
  return { ...record, moved: result.moved }
}
