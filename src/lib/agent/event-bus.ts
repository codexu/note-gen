import type { AgentTraceEvent, AgentTool, AgentToolResult } from './types'

export type AgentEventName =
  | 'before-model-call'
  | 'after-model-call'
  | 'pre-tool-use'
  | 'post-tool-use'
  | 'run-stop'
  | 'run-error'

export interface AgentEventPayloads {
  'before-model-call': { runId: string }
  'after-model-call': { runId: string; content?: string }
  'pre-tool-use': { runId: string; tool: AgentTool; input: Record<string, unknown> }
  'post-tool-use': {
    runId: string
    tool: AgentTool
    input: Record<string, unknown>
    result: AgentToolResult
  }
  'run-stop': { runId: string; trace: AgentTraceEvent[] }
  'run-error': { runId: string; error: Error }
}

type AgentEventHandler<T extends AgentEventName> = (
  payload: AgentEventPayloads[T]
) => void | string | Promise<void | string>

export class AgentEventBus {
  private handlers: {
    [K in AgentEventName]?: Array<AgentEventHandler<K>>
  } = {}

  on<T extends AgentEventName>(event: T, handler: AgentEventHandler<T>) {
    const existing = this.handlers[event] ?? []
    this.handlers[event] = [...existing, handler] as typeof this.handlers[T]

    return () => {
      this.handlers[event] = (this.handlers[event] ?? []).filter(
        (candidate) => candidate !== handler
      ) as typeof this.handlers[T]
    }
  }

  async emit<T extends AgentEventName>(
    event: T,
    payload: AgentEventPayloads[T]
  ): Promise<string | undefined> {
    const handlers = this.handlers[event] ?? []

    for (const handler of handlers) {
      const result = await handler(payload)
      if (typeof result === 'string' && result.trim()) {
        return result
      }
    }

    return undefined
  }
}

export const agentEventBus = new AgentEventBus()
