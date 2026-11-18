/**
 * Fork（almanac ALMNC-21）：今天頁、收集、時段提案寫日誌時改走 note-rewrite 的編輯器協調。
 *
 * 原本這些動作讀檔、算出新內容後直接 writeNote。日誌正開在編輯器、使用者有未存的輸入時，
 * 寫入不會反映到編輯器，之後的防抖存檔可能把剛寫進去的內容蓋掉。
 *
 * 這裡的做法：
 * - 寫入經 rewriteNotes：排進編輯器的存檔佇列、以最新內容（開著的那篇用編輯器裡的內容）為準、
 *   寫完通知編輯器重新載入；
 * - 最新內容等於動作當時讀到的 `before`：直接寫 `after`；
 * - 不同（使用者之後又改過）：有 `rebase` 就把同一個動作重新套到最新內容；沒有或套不上就丟
 *   NoteWriteConflict，不覆蓋任何內容。
 * 回傳實際寫入的前後內容，讓復原紀錄對得上磁碟。
 */
import { rewriteNotes } from '@/lib/note-rewrite'

export class NoteWriteConflict extends Error {
  constructor(public readonly path: string) {
    super(`筆記在寫入前已被修改：${path}`)
    this.name = 'NoteWriteConflict'
  }
}

export interface CoordinatedWrite {
  path: string
  before: string
  after: string
  /** 最新內容與 before 不同時，把同一個動作套到最新內容；回傳 null 代表套不上。 */
  rebase?: (latest: string) => string | null
}

export interface CommittedWrite {
  path: string
  before: string
  after: string
}

function normalize(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

export async function commitNoteWrites(writes: CoordinatedWrite[]): Promise<CommittedWrite[]> {
  if (writes.length === 0) return []
  const result = await rewriteNotes(writes.map(write => ({
    path: write.path,
    rewrite: (latest: string) => {
      if (latest === write.before) return write.after
      const rebased = write.rebase?.(latest) ?? null
      if (rebased === null) throw new NoteWriteConflict(write.path)
      return rebased
    },
  })))
  // rewriteNotes 只回傳真的有改到的檔案，依呼叫順序整理回來
  const byPath = new Map(result.map(item => [normalize(item.path), item]))
  return writes.flatMap(write => {
    const item = byPath.get(normalize(write.path))
    return item ? [{ path: write.path, before: item.previousContent, after: item.content }] : []
  })
}

/** 復原：檔案仍是我們寫入的內容才還原，否則回傳 false，不動任何內容。 */
export async function revertNoteWrites(writes: CommittedWrite[]): Promise<boolean> {
  try {
    await commitNoteWrites([...writes].reverse().map(write => ({ path: write.path, before: write.after, after: write.before })))
    return true
  } catch {
    return false
  }
}
