import { AgentSessionController } from './agent-session'

class AgentSessionManager {
  private readonly sessions = new Map<string, AgentSessionController<unknown>>()

  getOrCreate<TRequest>(sessionId: string) {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing as unknown as AgentSessionController<TRequest>

    const session = new AgentSessionController<TRequest>()
    this.sessions.set(sessionId, session as unknown as AgentSessionController<unknown>)
    return session
  }

  get(sessionId: string) {
    return this.sessions.get(sessionId)
  }

  rekey(currentSessionId: string, nextSessionId: string) {
    if (currentSessionId === nextSessionId) return this.sessions.get(currentSessionId)
    const session = this.sessions.get(currentSessionId)
    if (!session) return this.sessions.get(nextSessionId)

    const existing = this.sessions.get(nextSessionId)
    if (existing && existing !== session) {
      if (existing.isStreaming || existing.pendingMessages.length > 0) return existing
      existing.dispose()
    }

    this.sessions.delete(currentSessionId)
    this.sessions.set(nextSessionId, session)
    return session
  }

  dispose(sessionId: string) {
    this.sessions.get(sessionId)?.dispose()
    this.sessions.delete(sessionId)
  }

  disposeAll() {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
  }
}

export const agentSessionManager = new AgentSessionManager()
