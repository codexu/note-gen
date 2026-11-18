// Fork（almanac ALMNC-8）：收下提案＝寫進既有位置，不新增資料表。
// 筆記 → 收件資料夾的新檔；任務、時段 → 今日日誌的「捕捉軌」區塊（時段是帶 ⏰ 的任務行，今日頁的時間軸讀得到）。
import { noteExists, readNote, revealInFileTree, writeNote } from '@/lib/daily/note-io'
import { toDateKey } from '@/lib/daily/format'
import { ensureDailyNote } from '@/lib/daily/open-daily-note'
import { captureFileName, capturePath } from '@/lib/home/capture'
import { QUICK_ADD_SECTION, undoWrites, type WriteRecord } from '@/lib/today/today-actions'
import { insertLinesInSection } from '@/lib/today/today-model'
import { proposalNoteContent, proposalTaskLine } from './builders'
import type { Proposal } from './types'

export interface AcceptResult {
  /** 寫入的檔案。 */
  path: string
  /** 任務、時段的復原資料；筆記沒有（檔案已出現在檔案樹，要刪從那裡刪）。 */
  record?: WriteRecord
}

export async function acceptProposal(proposal: Proposal, options: { noteFolder: string, now?: Date }): Promise<AcceptResult> {
  const now = options.now ?? new Date()

  if (proposal.kind === 'note') {
    const name = captureFileName(proposal.title, now)
    let path: string | null = null
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = capturePath(options.noteFolder, name, attempt)
      if (await noteExists(candidate)) continue
      path = candidate
      break
    }
    if (!path) throw new Error('too many notes with the same name')
    await writeNote(path, proposalNoteContent(proposal))
    await revealInFileTree(path)
    return { path }
  }

  const { path } = await ensureDailyNote(now)
  const before = await readNote(path) ?? ''
  const after = insertLinesInSection(before, [proposalTaskLine(proposal, toDateKey(now))], QUICK_ADD_SECTION)
  await writeNote(path, after)
  return { path, record: { writes: [{ path, before, after }] } }
}

/** 復原任務、時段（檔案被別處改過就不動，回傳 false）。 */
export function undoAccepted(result: AcceptResult): Promise<boolean> {
  return result.record ? undoWrites(result.record) : Promise.resolve(false)
}
