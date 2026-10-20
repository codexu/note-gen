import type { AgentTraceEvent } from './types'

export function retainCompletedAgentTraceEvents(events: AgentTraceEvent[]) {
  return events.filter((event) =>
    event.type !== 'model_call' &&
    (event.type !== 'model_response' || event.isIntermediateResponse)
  )
}
