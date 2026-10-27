import type { AgentTraceEvent } from './types'

export function retainCompletedAgentTraceEvents(events: AgentTraceEvent[]) {
  return events.filter((event) =>
    event.type !== 'model_call' &&
    (event.type !== 'model_response' || event.isIntermediateResponse
      || (event.isIntermediateResponse === false && event.output === undefined)
      || Boolean(event.reasoning?.trim()) || typeof event.output === 'string')
  ).map(event => event.type === 'model_response' && !event.isIntermediateResponse
    // The final text is stored on the chat; retain timing and reasoning here.
    ? { ...event, isIntermediateResponse: false, output: undefined }
    : event)
}
