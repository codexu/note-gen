import { describe, expect, it } from 'vitest'
import { applyCardAction, formatWhen, parseThreadCard, resolveThreadCard, type KickoffResultCardData, type ProposalCardData } from './cards'

const proposal: ProposalCardData = { type: 'proposal', id: 'p1', kind: 'task', title: '寄出報價', due: '2026-11-20', time: '14:30', status: 'wait' }
const kickoff: KickoffResultCardData = {
  type: 'kickoff-result', id: 'k1', title: 'Q4 提案', state: 'proposed', placeholder: true,
  tasks: [
    { n: 1, text: '收集競品', owner: 'research', status: 'done' },
    { n: 2, text: '寫初稿', owner: 'writer', status: 'run', dependsOn: [1] },
    { n: 3, text: '校稿', status: 'wait', dependsOn: [2] },
  ],
  acceptance: [{ text: '有三個競品', status: 'ok' }, { text: '引用齊全', status: 'look' }, { text: '一頁內', status: 'open' }],
}

describe('threads/cards', () => {
  it('formatWhen', () => {
    expect(formatWhen('2026-11-20', '14:30')).toBe('11/20 14:30')
    expect(formatWhen('2026-11-20')).toBe('11/20')
    expect(formatWhen(undefined, '09:00')).toBe('09:00')
    expect(formatWhen('明天')).toBe('明天')
    expect(formatWhen()).toBe('')
  })

  it('提案卡：等待中可收下／不要，處理後沒有動作', () => {
    const view = resolveThreadCard(proposal)
    expect(view).toMatchObject({ type: 'proposal', when: '11/20 14:30', statusKey: 'proposalWait', tone: 'pending', actions: ['accept', 'reject'] })
    expect(resolveThreadCard({ ...proposal, status: 'ok' })).toMatchObject({ statusKey: 'proposalOk', tone: 'done', actions: [] })
    expect(resolveThreadCard({ ...proposal, status: 'no' })).toMatchObject({ statusKey: 'proposalNo', tone: 'muted', actions: [] })
  })

  it('開工卡：待開工只有開工／先不開，不顯示每件進度', () => {
    const view = resolveThreadCard(kickoff)
    expect(view).toMatchObject({ type: 'kickoff-result', stateKey: 'kickoffProposed', done: 1, total: 3, showTaskStatus: false, needsLook: 1, placeholder: true, actions: ['start', 'hold'] })
  })

  it('開工卡：進行中顯示進度且沒有動作；先不開可改回待開工', () => {
    expect(resolveThreadCard({ ...kickoff, state: 'running' })).toMatchObject({ stateKey: 'kickoffRunning', showTaskStatus: true, actions: [] })
    expect(resolveThreadCard({ ...kickoff, state: 'done' })).toMatchObject({ stateKey: 'kickoffDone', showTaskStatus: true, actions: [] })
    expect(resolveThreadCard({ ...kickoff, state: 'cancelled' })).toMatchObject({ stateKey: 'kickoffCancelled', showTaskStatus: false, actions: ['reopen'] })
  })

  it('applyCardAction 只做適用的轉換', () => {
    expect(applyCardAction(proposal, 'accept')).toMatchObject({ status: 'ok' })
    expect(applyCardAction(proposal, 'reject')).toMatchObject({ status: 'no' })
    expect(applyCardAction(proposal, 'start')).toBe(proposal)
    const accepted = applyCardAction(proposal, 'accept')
    expect(applyCardAction(accepted, 'reject')).toBe(accepted)
    expect(applyCardAction(kickoff, 'start')).toMatchObject({ state: 'running' })
    expect(applyCardAction(kickoff, 'hold')).toMatchObject({ state: 'cancelled' })
    const held = applyCardAction(kickoff, 'hold')
    expect(applyCardAction(held, 'reopen')).toMatchObject({ state: 'proposed' })
    expect(applyCardAction(held, 'start')).toBe(held)
  })

  it('parseThreadCard：合法資料通過、缺欄位或未知型別回 null', () => {
    expect(parseThreadCard(proposal)).toEqual({ ...proposal, detail: undefined, source: undefined })
    expect(parseThreadCard({ type: 'proposal', id: 'x', kind: 'note', title: 't', status: 'weird' })).toMatchObject({ status: 'wait' })
    expect(parseThreadCard({ type: 'proposal', id: 'x', kind: 'bogus', title: 't' })).toBeNull()
    expect(parseThreadCard({ type: 'proposal', kind: 'note', title: 't' })).toBeNull()
    expect(parseThreadCard({ type: 'unknown', id: 'x' })).toBeNull()
    expect(parseThreadCard(null)).toBeNull()
    expect(parseThreadCard('x')).toBeNull()
    const parsed = parseThreadCard({ type: 'kickoff-result', id: 'k', title: 'T', state: 'running', tasks: [{ text: 'a' }, { nope: 1 }], acceptance: [{ text: 'b', status: 'zzz' }] })
    expect(parsed).toMatchObject({ type: 'kickoff-result', tasks: [{ n: 1, text: 'a', status: 'wait' }], acceptance: [{ text: 'b', status: 'open' }] })
    expect(parseThreadCard({ type: 'kickoff-result', id: 'k', title: 'T', state: 'bad' })).toBeNull()
  })
})
