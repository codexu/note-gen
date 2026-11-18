import { describe, expect, it } from 'vitest'

import { isSupportedLocale, loadMessagesWithFallback, mergeMessages, normalizeLocale } from './config'

// Fork：上游把 zh-TW 移成插件；fork 保留內建，同步上游時不可以被改回去。
describe('內建繁體中文', () => {
  it('zh-TW 仍是內建語言，存過的選擇不會被重設', () => {
    expect(isSupportedLocale('zh-TW')).toBe(true)
    expect(normalizeLocale('zh-TW')).toBe('zh-TW')
  })

  it('載入繁中字串與 common，不是英文', async () => {
    const messages = await loadMessagesWithFallback('zh-TW') as {
      inbox: { noTags: string }
      common: { noteGenFree: string }
    }
    expect(messages.inbox.noTags).toBe('還沒有標籤')
    expect(messages.common.noteGenFree).toBe('免費')
  })

  it('繁中缺的字串退回簡中，不退回英文', () => {
    // almanac P8 補齊了 zh-TW 的所有缺鍵（見 locale-parity.test.ts），真實檔案已沒有缺字；
    // 改用固定的缺字資料驗證合併規則：zh-TW 有的保留，缺的取簡中，不會取英文。
    const zhTW = { settings: { memories: { actions: { reject: '拒絕' } } } }
    const zh = { settings: { memories: { actions: { approve: '确认', reject: '拒绝' } } } }
    const merged = mergeMessages(zhTW, zh) as typeof zh
    expect(merged.settings.memories.actions.approve).toBe('确认')
    expect(merged.settings.memories.actions.reject).toBe('拒絕')
  })

  it('已移除的內建語言退回簡中，等語言插件接手', () => {
    expect(normalizeLocale('de')).toBe('zh')
  })
})
