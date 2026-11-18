import { describe, expect, it, vi } from 'vitest'
import type { AgentTool } from '@/lib/agent/types'
import type { AgentTask, AgentRunnerKind } from '@/lib/agent-tasks/types'
import type { AgentSettings } from './settings'

const { getSettings, recordRefusal, request, preview, execute, readNote } = vi.hoisted(() => ({
  getSettings: vi.fn<(id: string) => Promise<AgentSettings | undefined>>(),
  recordRefusal: vi.fn(async () => {}),
  request: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn<AgentTool['execute']>(),
  readNote: vi.fn(async () => null),
}))

const makeTool = (name: string, risk: AgentTool['risk']): AgentTool => ({
  name, title: name, description: name, category: 'note', risk,
  inputSchema: { type: 'object', properties: { fileName: { type: 'string' }, content: { type: 'string' } } },
  execute,
})

vi.mock('@/db/agents', () => ({ getAgentSettings: getSettings, recordAgentToolRefusal: recordRefusal }))
vi.mock('@/lib/daily/note-io', () => ({ readNote }))
vi.mock('@/lib/workspace', () => ({ getWorkspacePath: async () => ({ isCustom: true, path: '/test' }) }))
vi.mock('@/lib/skills/runtime', () => ({ getSkillWorkspaceIdentity: () => '/test', getSkillScriptPermissionKey: vi.fn() }))
vi.mock('@/lib/skills', () => ({ skillManager: {} }))
vi.mock('@/lib/context/loader', () => ({ memoryContextService: { formatMemoryContext: () => '' } }))
vi.mock('@/lib/mcp/agent-tools', () => ({ buildMcpAgentToolCatalog: () => ({ directTools: [], deferredEntries: [] }) }))
vi.mock('@/lib/rag-agent-policy', () => ({ getRagAgentPolicy: async () => ({ automaticSearchEnabled: false }) }))
vi.mock('@/lib/agent/tool-registry', () => ({
  agentToolRegistry: {
    listTools: () => [
      makeTool('note_read_file', 'read'), makeTool('note_create_file', 'file-create'),
      makeTool('note_delete_file', 'delete'), makeTool('note_open_file', 'read'),
    ],
    toOpenAITools: (tools: AgentTool[]) => tools.map(tool => ({ type: 'function', function: { name: tool.name } })),
  },
  LOADED_SKILL_TOOL_NAMES: new Set(),
  hasFileEditPreview: (name: string) => ['note_create_file', 'note_delete_file'].includes(name),
  buildEditorApprovalPreview: preview,
  validateEditApprovalPreview: async () => undefined,
}))
vi.mock('@/lib/ai/utils', () => ({
  getAISettings: async () => ({ model: 'fixture', baseURL: 'https://example.test' }),
  validateAIService: async (url: string) => url,
  getSystemPromptContent: async () => '',
  getChatTokenLimitParams: () => ({}),
  createOpenAIClient: async () => ({}),
  withFastAiRequestOptions: (params: unknown) => params,
  createAssistantToolCallMessage: (content: unknown, calls: unknown) =>
    ({ role: 'assistant', content, tool_calls: calls }),
  createChatCompletionStreamWithToolChoiceFallback: async (_client: unknown, params: unknown) => request(params),
  handleAIError: async () => undefined,
}))

import { AgentTaskCenter } from '@/lib/agent-tasks/task-center'
import { applyDraft } from '@/lib/agent-tasks/review'
import { authorizeAgentTool, type AgentToolRefusal } from './permissions'
import { createAgentRunner } from './runner'

function fixtureCenter() {
  const persisted = new Map<string, AgentTask>()
  const notify = vi.fn()
  const legacyRuntime = vi.fn(() => { throw new Error('Unexpected fallback to unrestricted background runner') })
  const center = new AgentTaskCenter({
    createRuntime: legacyRuntime, now: Date.now, concurrency: async () => 1, load: async () => [],
    persist: async task => { persisted.set(task.id, task) },
    remove: async id => { persisted.delete(id) },
    notify,
  })
  return { center, persisted, notify, legacyRuntime }
}

async function* toolCalls(...calls: Array<[string, string]>) {
  yield {
    choices: [{
      finish_reason: 'tool_calls',
      delta: { tool_calls: calls.map(([name, args], index) => ({
        index, id: `call-${index}`, function: { name, arguments: args },
      })) },
    }],
  }
}

async function* finalReply() {
  yield { choices: [{ finish_reason: 'stop', delta: { content: 'Draft ready.' } }] }
}

describe('P5 agent runners and permissions', () => {
  it('filters the model schema, audits unsolicited calls before preview, and stages the allowed draft for review', async () => {
    const agent: AgentSettings = {
      id: 'organizer', name: 'Organizer', role: 'organizer', enabled: true,
      allowedTools: ['note_create_file'], createdAt: 1, updatedAt: 1,
    }
    getSettings.mockResolvedValue(agent)
    preview.mockImplementation(async (_name, args) => ({
      previewParams: { ...args, workspaceIdentity: '/test' },
    }))
    request.mockImplementationOnce(() => toolCalls(
      ['note_delete_file', 'malformed JSON'],
      ['note_read_file', '{"filePath":"private.md"}'],
      ['note_open_file', '{"filePath":"private.md"}'],
      ['unknown_tool', '{}'],
      ['note_create_file', '{"fileName":"new.md","content":"Proposal"}'],
    )).mockImplementationOnce(finalReply)

    const { center, persisted, notify, legacyRuntime } = fixtureCenter()
    const kind: AgentRunnerKind = 'agent:organizer'
    const task = await center.enqueue({ kind, prompt: 'Organize this capture' })
    await vi.waitFor(() => expect(center.get(task.id)?.status).toBe('queued'))
    expect(legacyRuntime).not.toHaveBeenCalled()
    center.registerRunner(kind, createAgentRunner(kind))

    await vi.waitFor(() => expect(['awaiting_review', 'completed', 'failed']).toContain(persisted.get(task.id)?.status))
    expect(persisted.get(task.id)?.status, JSON.stringify(request.mock.calls.map(([p]) => p.messages.filter((m: { role: string }) => m.role === 'tool')))).toBe('awaiting_review')
    expect(notify).toHaveBeenCalledWith('awaiting_review', expect.objectContaining({ id: task.id }))
    expect(request.mock.calls[0][0].tools).toEqual([{ type: 'function', function: { name: 'note_create_file' } }])
    const toolMessages = request.mock.calls[1][0].messages.filter((message: { role: string }) => message.role === 'tool')
    expect(toolMessages.slice(0, 4)).toEqual(Array.from({ length: 4 }, () =>
      expect.objectContaining({ content: expect.stringContaining('AGENT_TOOL_REFUSED') }),
    ))
    expect(recordRefusal.mock.calls).toEqual(['note_delete_file', 'note_read_file', 'note_open_file', 'unknown_tool']
      .map(toolName => [expect.objectContaining({ agentId: agent.id, taskId: task.id, toolName, reason: 'not_granted' })]))
    expect(preview).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    const [draft] = persisted.get(task.id)!.drafts
    expect(draft).toMatchObject({ path: 'new.md', content: 'Proposal', state: 'pending' })

    execute.mockResolvedValue({ ok: true, message: 'written' })
    const approved = await applyDraft(draft, { readFile: readNote, getTool: name => makeTool(name, 'file-create') })
    expect(approved.state).toBe('applied')
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fileName: 'new.md', content: 'Proposal', workspaceIdentity: '/test' }),
      expect.objectContaining({ runId: `review-${draft.id}` }),
    )
  })

  it('checks live grants and records disabled, revoked, and unavailable tools', async () => {
    const record = vi.fn(async () => {})
    const context = { agentId: 'a', taskId: 't' }
    const agent: AgentSettings = {
      id: 'a', name: 'A', role: 'custom', enabled: true,
      allowedTools: ['note_read_file'], createdAt: 0, updatedAt: 0,
    }
    expect(await authorizeAgentTool('note_read_file', true, agent, context, record)).toBeUndefined()
    expect(record).not.toHaveBeenCalled()
    const checks: Array<[boolean, AgentSettings | undefined, AgentToolRefusal['reason']]> = [
      [false, agent, 'unavailable'],
      [true, { ...agent, allowedTools: [] }, 'not_granted'],
      [true, { ...agent, enabled: false }, 'disabled'],
      [true, undefined, 'disabled'],
    ]
    for (const [offered, settings, reason] of checks) {
      expect(await authorizeAgentTool('note_read_file', offered, settings, context, record))
        .toMatchObject({ ok: false, error: 'AGENT_TOOL_REFUSED' })
      expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ ...context, toolName: 'note_read_file', reason }))
    }
  })

  it('refuses a queued agent that was disabled before execution', async () => {
    getSettings.mockResolvedValue(undefined)
    request.mockClear()
    const { center, persisted } = fixtureCenter()
    const kind: AgentRunnerKind = 'agent:disabled'
    center.registerRunner(kind, createAgentRunner(kind))
    const task = await center.enqueue({ kind, prompt: 'Do work' })
    await vi.waitFor(() => expect(persisted.get(task.id)).toMatchObject({ status: 'failed', error: 'AGENT_DISABLED' }))
    expect(request).not.toHaveBeenCalled()
  })
})
