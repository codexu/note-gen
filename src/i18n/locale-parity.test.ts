import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import zhTW from '../../messages/zh-TW.json'

const v3Namespaces = ['collect', 'anywhere', 'decide', 'threads', 'agents', 'jobs', 'week', 'todayV3', 'sidebarV3'] as const

function messageKeys(messages: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? messageKeys(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('Traditional Chinese locale parity', () => {
  const translated = new Set(messageKeys(zhTW))

  it.each([['zh', zh], ['en', en]] as const)('covers every %s message', (_locale, messages) => {
    expect(messageKeys(messages).filter(key => !translated.has(key))).toEqual([])
  })

  it.each(v3Namespaces)('has the same %s messages in all three locales', namespace => {
    const keys = messageKeys(zhTW[namespace]).sort()
    expect(messageKeys(zh[namespace]).sort()).toEqual(keys)
    expect(messageKeys(en[namespace]).sort()).toEqual(keys)
  })

  it('keeps shared messages in Simplified Chinese locale order', () => {
    const reference = new Set(messageKeys(zh))
    expect(messageKeys(zhTW).filter(key => reference.has(key))).toEqual([...reference])
  })
})
