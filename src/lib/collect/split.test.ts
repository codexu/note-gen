import { describe, expect, it } from 'vitest'
import { proposalNoteContent, proposalTaskLine } from './builders'
import { buildSplitPrompt, extractSchedule, parseAiProposals, splitByRules, splitInput } from './split'
import type { CollectInput } from './types'

// 2026-11-18 是週三
const NOW = new Date(2026, 10, 18, 9, 0, 0)
const text = (value: string): CollectInput => ({ kind: 'text', text: value })

describe('extractSchedule', () => {
  it('明天三點前交預算表 → 日期、時間與乾淨的標題', () => {
    expect(extractSchedule('明天三點前交預算表', NOW)).toEqual({ title: '交預算表', due: '2026-11-19', time: '15:00' })
  })

  it('下午三點在上午以外的時段會換成 24 小時制', () => {
    expect(extractSchedule('週五下午三點和 Amy 開會', NOW)).toEqual({ title: '和 Amy 開會', due: '2026-11-20', time: '15:00' })
  })

  it('只有時間沒有日期時，日期是今天', () => {
    expect(extractSchedule('15:30 寄報價單', NOW)).toEqual({ title: '寄報價單', due: '2026-11-18', time: '15:30' })
  })

  it('沒有日期時間就保留原句', () => {
    expect(extractSchedule('整理桌面', NOW)).toEqual({ title: '整理桌面', due: '', time: '' })
  })
})

describe('splitByRules', () => {
  it('一句短話帶日期 → 一個任務', () => {
    const [task, ...rest] = splitByRules(text('下週一交報告'), NOW)
    expect(rest).toHaveLength(0)
    expect(task).toMatchObject({ kind: 'task', title: '交報告', due: '2026-11-23', time: '' })
  })

  it('一句短話帶時間 → 一個時段', () => {
    const result = splitByRules(text('明天下午兩點約 Amy'), NOW)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'event', due: '2026-11-19', time: '14:00', title: '約 Amy' })
  })

  it('連結 → 只有一則筆記', () => {
    const result = splitByRules({ kind: 'link', text: 'https://www.latent.space/p/agent-memory' }, NOW)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'note', title: 'latent.space' })
    expect(result[0].body).toContain('https://www.latent.space/p/agent-memory')
  })

  it('長文字 → 一則筆記，外加明確寫出的待辦行', () => {
    const body = ['定價我直覺覺得用量計費比較公平，但使用者很難預估費用。', '- [ ] 找兩家用量計費的例子', '待辦：週五下午三點對一次定價'].join('\n')
    const result = splitByRules(text(body), NOW)
    expect(result.map(p => p.kind)).toEqual(['note', 'task', 'event'])
    expect(result[1].title).toBe('找兩家用量計費的例子')
    expect(result[2]).toMatchObject({ title: '對一次定價', due: '2026-11-20', time: '15:00' })
  })

  it('沒有任何待辦線索的文字 → 退回只有一則筆記', () => {
    const result = splitByRules(text('今天讀了一篇關於記憶的文章，覺得三層結構很有意思。\n第二段繼續想。'), NOW)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('note')
  })

  it('圖片 → 以檔名為標題的筆記', () => {
    const result = splitByRules({ kind: 'image', text: '', name: '白板.png' }, NOW)
    expect(result).toEqual([expect.objectContaining({ kind: 'note', title: '白板.png' })])
  })

  it('空輸入不產生提案', () => {
    expect(splitByRules(text('   '), NOW)).toEqual([])
  })
})

describe('parseAiProposals', () => {
  it('解析 JSON，一次多個提案', () => {
    const raw = JSON.stringify({ proposals: [
      { kind: 'note', title: 'Agent 記憶的三種寫法', body: '對話摘要、向量回憶、結構化事實。', tags: ['#agent-memory'] },
      { kind: 'task', title: '寄報價單給 Amy', due: '2026-11-20' },
      { kind: 'event', title: '與 Amy 開會', due: '2026-11-24', time: '10:00' },
    ] })
    const result = parseAiProposals(raw)
    expect(result.map(p => p.kind)).toEqual(['note', 'task', 'event'])
    expect(result[0].tags).toEqual(['agent-memory'])
    expect(result[2]).toMatchObject({ due: '2026-11-24', time: '10:00' })
    expect(new Set(result.map(p => p.id)).size).toBe(3)
  })

  it('接受程式碼框、think 標籤與直接給陣列', () => {
    const raw = '<think>先想一下</think>\n```json\n[{"kind":"task","title":"整理桌面"}]\n```'
    expect(parseAiProposals(raw)).toEqual([expect.objectContaining({ kind: 'task', title: '整理桌面' })])
  })

  it('event 缺時間降成 task；不合法的日期被清掉', () => {
    const result = parseAiProposals('{"proposals":[{"kind":"event","title":"開會","due":"2026-11-24"},{"kind":"task","title":"交件","due":"2026-13-40"}]}')
    expect(result[0]).toMatchObject({ kind: 'task', due: '2026-11-24', time: '' })
    expect(result[1]).toMatchObject({ kind: 'task', due: '' })
  })

  it('丟掉不認得的 kind 與空標題，最多 8 個', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'task', title: `事 ${i}` }))
    const result = parseAiProposals(JSON.stringify({ proposals: [{ kind: 'tag', title: 'x' }, { kind: 'task', title: '  ' }, ...many] }))
    expect(result).toHaveLength(8)
    expect(result.every(p => p.kind === 'task')).toBe(true)
  })

  it('不是 JSON 或沒有提案時回傳空陣列', () => {
    expect(parseAiProposals('抱歉我做不到')).toEqual([])
    expect(parseAiProposals('{"proposals":"nope"}')).toEqual([])
    expect(parseAiProposals('{"proposals":[')).toEqual([])
  })
})

describe('splitInput', () => {
  it('AI 有結果時用 AI', async () => {
    const ask = async () => '{"proposals":[{"kind":"note","title":"筆記"},{"kind":"task","title":"待辦"}]}'
    const result = await splitInput(text('隨便一段話'), NOW, ask)
    expect(result.source).toBe('ai')
    expect(result.proposals).toHaveLength(2)
  })

  it('AI 丟錯誤時退回規則，長文字只有一則筆記', async () => {
    const ask = async () => { throw new Error('AI service not configured') }
    const result = await splitInput(text('這是一段沒有待辦線索的長一點的想法，應該只變成一則筆記而已。'), NOW, ask)
    expect(result.source).toBe('rules')
    expect(result.proposals.map(p => p.kind)).toEqual(['note'])
  })

  it('AI 回傳解析不出來時也退回規則', async () => {
    const result = await splitInput(text('明天三點交預算表'), NOW, async () => '我不知道')
    expect(result.source).toBe('rules')
    expect(result.proposals[0]).toMatchObject({ kind: 'event', time: '15:00' })
  })

  it('沒有注入 AI 時直接用規則', async () => {
    expect((await splitInput(text('下週一交報告'), NOW)).source).toBe('rules')
  })

  it('把圖片傳給模型', async () => {
    let seen: string | undefined
    await splitInput({ kind: 'image', text: '', name: 'a.png', imageDataUrl: 'data:image/png;base64,AAAA' }, NOW, async (_prompt, image) => { seen = image; return '[]' })
    expect(seen).toBe('data:image/png;base64,AAAA')
  })
})

describe('buildSplitPrompt', () => {
  it('帶入今天的日期與使用者內容', () => {
    const prompt = buildSplitPrompt(text('明天交預算表'), NOW)
    expect(prompt).toContain('2026-11-18（週三）')
    expect(prompt).toContain('明天交預算表')
  })
})

describe('proposal builders', () => {
  it('任務行：沒日期預設今天，標籤接在後面', () => {
    const line = proposalTaskLine({ id: 'a', kind: 'task', title: '找例子', body: '', due: '', time: '', tags: ['定價'] }, '2026-11-18')
    expect(line).toBe('- [ ] 找例子 📅 2026-11-18 #定價')
  })

  it('時段行帶 📅 與 ⏰', () => {
    const line = proposalTaskLine({ id: 'a', kind: 'event', title: '與 Amy 開會', body: '', due: '2026-11-24', time: '10:00', tags: [] }, '2026-11-18')
    expect(line).toBe('- [ ] 與 Amy 開會 📅 2026-11-24 ⏰ 10:00')
  })

  it('筆記內容：標題、內文、標籤', () => {
    const content = proposalNoteContent({ id: 'a', kind: 'note', title: '速記', body: '內文', due: '', time: '', tags: ['想法'] })
    expect(content).toBe('# 速記\n\n內文\n\n#想法\n')
  })
})

describe('extractSchedule 的誤判', () => {
  it('「一點」沒有時段詞時不當成一點鐘', () => {
    expect(extractSchedule('有一點想法', NOW)).toEqual({ title: '有一點想法', due: '', time: '' })
    expect(extractSchedule('明天下午一點開會', NOW)).toMatchObject({ due: '2026-11-19', time: '13:00' })
  })
})
