import type { AgentRunStatus, AgentTraceEvent } from './types'

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export class AgentTraceRecorder {
  private readonly runId: string
  private events: AgentTraceEvent[] = []
  private status: AgentRunStatus = 'idle'

  constructor(runId = createId('run')) {
    this.runId = runId
  }

  getRunId() {
    return this.runId
  }

  getStatus() {
    return this.status
  }

  setStatus(status: AgentRunStatus) {
    this.status = status
  }

  add(event: Omit<AgentTraceEvent, 'id' | 'runId' | 'timestamp'> & { id?: string }) {
    const traceEvent: AgentTraceEvent = {
      id: event.id ?? createId(event.type),
      runId: this.runId,
      timestamp: Date.now(),
      ...event,
    }

    this.events.push(traceEvent)
    return traceEvent
  }

  update(id: string, updates: Partial<Omit<AgentTraceEvent, 'id' | 'runId'>>) {
    const event = this.events.find((item) => item.id === id)
    if (!event) {
      return undefined
    }

    Object.assign(event, updates)
    return event
  }

  all() {
    return [...this.events]
  }
}

export { createId as createAgentId }
