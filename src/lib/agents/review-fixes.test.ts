// almanac ALMNC-12 複審修正：路徑限制、拒絕紀錄寫入失敗時的錯誤碼。
import { describe, expect, it } from 'vitest'
import { authorizeAgentTool } from './permissions'
import { isSafeVaultPath } from './runner'

describe('isSafeVaultPath', () => {
  it('accepts vault-relative paths', () => {
    expect(isSafeVaultPath('10 Inbox/想法.md')).toBe(true)
    expect(isSafeVaultPath('note.md')).toBe(true)
    expect(isSafeVaultPath('a..b/x.md')).toBe(true)
  })

  it('rejects traversal, absolute roots and backslashes', () => {
    for (const bad of ['../x.md', 'a/../../x.md', '/etc/x.md', 'C:/x.md', '~/x.md', 'a\\x.md']) {
      expect(isSafeVaultPath(bad), bad).toBe(false)
    }
  })
})

describe('authorizeAgentTool audit failure', () => {
  it('fails closed with AGENT_AUDIT_FAILED when the refusal cannot be recorded', async () => {
    await expect(authorizeAgentTool('note_delete_file', true, undefined, { agentId: 'a', taskId: 't' }, async () => {
      throw new Error('database is locked')
    })).rejects.toThrow('AGENT_AUDIT_FAILED: database is locked')
  })
})
