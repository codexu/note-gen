import { getAgentSettings, recordAgentToolRefusal } from '@/db/agents'
import { AgentRuntime } from '@/lib/agent/runtime'
import type { AgentTool } from '@/lib/agent/types'
import { buildBackgroundTools, type DraftSink } from '@/lib/agent-tasks/draft-tools'
import { buildResumeNote } from '@/lib/agent-tasks/draft'
import type { TaskRunner } from '@/lib/agent-tasks/task-center'
import type { AgentRunnerKind } from '@/lib/agent-tasks/types'
import { loadCalendarEvents } from '@/lib/calendar/calendar'
import { authorizeAgentTool } from './permissions'
import { isAgentToolName, type AgentRole, type AgentToolName } from './settings'

const ROLE_INSTRUCTIONS: Record<AgentRole, string> = {
  organizer: 'Organize supplied captures into notes and tasks. Preserve source material and identify duplicates.',
  scheduler: 'Propose time blocks after checking relevant tasks and the calendar. Report missing calendar access or conflicts.',
  researcher: 'Summarize supplied sources and notes. Cite evidence and identify unknowns.',
  reviewer: 'Summarize progress, blockers, and possible next steps from the supplied period.',
  custom: 'Follow the assigned task.',
}

const PROPOSAL_TOOLS = new Set<string>(['note_create_file', 'note_update_file'])

const calendarTool: AgentTool = {
  name: 'calendar_read_day',
  title: 'Read calendar events for one day',
  description: 'Read the local calendar with existing device permission, using a local date (YYYY-MM-DD).',
  category: 'system',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: { date: { type: 'string' } },
    required: ['date'],
    additionalProperties: false,
  },
  execute: async ({ date }) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: 'INVALID_DATE', message: 'Expected a local date in YYYY-MM-DD format.' }
    }
    const day = new Date(`${date}T00:00:00`)
    const [year, month, dayOfMonth] = date.split('-').map(Number)
    if (day.getFullYear() !== year || day.getMonth() + 1 !== month || day.getDate() !== dayOfMonth) {
      return { ok: false, error: 'INVALID_DATE', message: 'Expected an existing calendar date.' }
    }
    const response = await loadCalendarEvents(day)
    return response.access === 'granted'
      ? { ok: true, message: 'Calendar events loaded.', data: response.events }
      : { ok: false, error: 'CALENDAR_UNAVAILABLE', message: `Calendar access: ${response.access}.` }
  },
}

function buildAgentTools(tools: AgentTool[], allowedTools: AgentToolName[], sink: DraftSink) {
  const eligible = [...tools, calendarTool].filter(tool =>
    isAgentToolName(tool.name) && allowedTools.includes(tool.name) &&
    (PROPOSAL_TOOLS.has(tool.name) || tool.risk === 'read')
  )
  return buildBackgroundTools(eligible, sink).map(tool => {
    if (!PROPOSAL_TOOLS.has(tool.name)) return tool
    return {
      ...tool,
      execute: async (input, context) => {
        const path = tool.name === 'note_create_file' ? input.fileName : input.filePath
        if (typeof path !== 'string' || !/\.md$/i.test(path.trim())) {
          return { ok: false, error: 'MARKDOWN_REQUIRED', message: 'Drafts require a Markdown note (.md).' }
        }
        return tool.execute(input, context)
      },
    } satisfies AgentTool
  })
}

/** Each persisted agent gets a runner that reloads its settings on every execution. */
export function createAgentRunner(kind: AgentRunnerKind): TaskRunner {
  const agentId = kind.slice('agent:'.length)
  return async (task, { signal, setTokens, draftSink }) => {
    const agent = await getAgentSettings(agentId)
    if (!agent?.enabled) throw new Error('AGENT_DISABLED')
    signal.throwIfAborted()

    const runtime = new AgentRuntime()
    const stop = () => runtime.stop()
    const tokenByEvent = new Map<string, number>()
    signal.addEventListener('abort', stop, { once: true })
    try {
      const result = await runtime.run({
        userInput: task.prompt,
        messages: [{
          role: 'system',
          content: [
            ROLE_INSTRUCTIONS[agent.role],
            'You are working in the background. Note tools only stage proposals for user review. Use Markdown paths and report missing facts.',
            buildResumeNote(task.drafts),
          ].filter(Boolean).join('\n\n'),
        }],
        useMemories: false,
        selectedMcpServerIds: [],
        selectedSkills: [],
        permissionMode: 'auto-edit',
        transformTools: tools => buildAgentTools(tools, agent.allowedTools, draftSink),
        authorizeToolCall: async (toolName, offered) => authorizeAgentTool(
          toolName, offered, await getAgentSettings(agentId), { agentId, taskId: task.id }, recordAgentToolRefusal,
        ),
      }, {
        // Only the draft wrappers may pass this callback. The vault write happens during review.
        requestConfirmation: async toolName => PROPOSAL_TOOLS.has(toolName) ? 'approved' : 'denied',
        onTrace: event => {
          if (typeof event.streamedTokenCount !== 'number') return
          tokenByEvent.set(event.id, event.streamedTokenCount)
          setTokens([...tokenByEvent.values()].reduce((total, tokens) => total + tokens, 0))
        },
      })
      if (result.stopped && !signal.aborted) throw new Error('AGENT_RUN_STOPPED')
      if (!result.content.trim() && !draftSink.drafts().length && !signal.aborted) throw new Error('AGENT_NO_RESULT')
      return { result: result.content }
    } finally {
      signal.removeEventListener('abort', stop)
    }
  }
}
