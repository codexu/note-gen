// Fork（almanac ALMNC-8）：把提案轉成要寫進檔案的文字。純函式。
import type { Proposal } from './types'

/** 任務與時段寫成 Obsidian Tasks 行；任務沒有日期時預設今天（today 為 YYYY-MM-DD）。 */
export function proposalTaskLine(proposal: Proposal, today: string): string {
  const due = proposal.due || (proposal.kind === 'task' || proposal.time ? today : '')
  const parts = ['- [ ]', proposal.title.replace(/\s*\n\s*/g, ' ').trim()]
  if (due) parts.push(`📅 ${due}`)
  if (proposal.time) parts.push(`⏰ ${proposal.time}`)
  parts.push(...proposal.tags.map(tag => `#${tag}`))
  return parts.join(' ')
}

/** 筆記檔內容：標題、內文、標籤。 */
export function proposalNoteContent(proposal: Proposal): string {
  const body = proposal.body.trim()
  const lines = [`# ${proposal.title.trim()}`]
  if (body) lines.push('', body)
  if (proposal.tags.length > 0) lines.push('', proposal.tags.map(tag => `#${tag}`).join(' '))
  return `${lines.join('\n')}\n`
}
