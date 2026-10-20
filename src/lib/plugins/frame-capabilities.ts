import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

interface TerminalOutput { sessionId: string; data: string }
interface TerminalClosed { sessionId: string }
interface FrameRequest { id?: unknown; method?: unknown; sessionId?: unknown; data?: unknown; cols?: unknown; rows?: unknown }

function dimensions(request: FrameRequest): { cols: number; rows: number } {
  const { cols, rows } = request
  if (typeof cols !== 'number' || typeof rows !== 'number'
    || !Number.isInteger(cols) || !Number.isInteger(rows)
    || cols < 2 || cols > 500 || rows < 1 || rows > 200) throw new Error('Invalid terminal size')
  return { cols, rows }
}

export async function connectPluginFrameCapabilities(options: {
  pluginId: string
  workspaceId: string
  port: MessagePort
  terminal: boolean
}): Promise<{ handle: (request: FrameRequest) => void; dispose: () => void }> {
  const { pluginId, workspaceId, port, terminal } = options
  const sessions = new Set<string>()
  const earlyOutput = new Map<string, string[]>()
  const earlyClosed = new Set<string>()
  let opening = 0
  let active = true
  let unlistenOutput: UnlistenFn | undefined
  let unlistenClosed: UnlistenFn | undefined
  const send = (message: Record<string, unknown>) => { if (active) port.postMessage(message) }
  const close = (sessionId: string) => invoke('plugin_terminal_close', { pluginId, workspaceId, sessionId })

  if (terminal) {
    unlistenOutput = await listen<TerminalOutput>('plugin-terminal-output', event => {
      if (!active) return
      const { sessionId, data } = event.payload
      if (sessions.has(sessionId)) send({ type: 'terminal.output', sessionId, data })
      else if (opening && (earlyOutput.has(sessionId) || earlyOutput.size < 16)) {
        const chunks = earlyOutput.get(sessionId) ?? []
        if (chunks.length < 128) chunks.push(data)
        earlyOutput.set(sessionId, chunks)
      }
    })
    try {
      unlistenClosed = await listen<TerminalClosed>('plugin-terminal-closed', event => {
        if (!active) return
        const { sessionId } = event.payload
        if (sessions.delete(sessionId)) send({ type: 'terminal.closed', sessionId })
        else if (opening && earlyClosed.size < 16) earlyClosed.add(sessionId)
      })
    } catch (error) {
      unlistenOutput?.()
      throw error
    }
  }

  const handle = (request: FrameRequest) => {
    if (!active || typeof request.id !== 'number' || !Number.isSafeInteger(request.id) || typeof request.method !== 'string') return
    const id = request.id as number
    const method = request.method
    void (async () => {
      if (!terminal || !method.startsWith('terminal.')) throw new Error('Capability unavailable')
      if (method === 'terminal.open') {
        opening += 1
        try {
          const sessionId = await invoke<string>('plugin_terminal_open', { pluginId, workspaceId, ...dimensions(request) })
          if (!active) { void close(sessionId).catch(() => undefined); return }
          sessions.add(sessionId)
          send({ id, result: sessionId })
          for (const data of earlyOutput.get(sessionId) ?? []) send({ type: 'terminal.output', sessionId, data })
          earlyOutput.delete(sessionId)
          if (earlyClosed.delete(sessionId)) {
            sessions.delete(sessionId)
            send({ type: 'terminal.closed', sessionId })
          }
        } finally {
          opening -= 1
          if (!opening) { earlyOutput.clear(); earlyClosed.clear() }
        }
        return
      }
      const sessionId = request.sessionId
      if (typeof sessionId !== 'string' || !sessions.has(sessionId)) throw new Error('Terminal session is unavailable')
      if (method === 'terminal.write') {
        if (typeof request.data !== 'string' || request.data.length > 65_536) throw new Error('Invalid terminal input')
        await invoke('plugin_terminal_write', { pluginId, workspaceId, sessionId, data: request.data })
      } else if (method === 'terminal.resize') {
        await invoke('plugin_terminal_resize', { pluginId, workspaceId, sessionId, ...dimensions(request) })
      } else if (method === 'terminal.close') {
        sessions.delete(sessionId)
        await close(sessionId)
      } else {
        throw new Error('Unknown capability method')
      }
      send({ id, result: null })
    })().catch(error => send({ id, error: String(error) }))
  }
  const dispose = () => {
    if (!active) return
    active = false
    unlistenOutput?.()
    unlistenClosed?.()
    for (const sessionId of sessions) void close(sessionId).catch(() => undefined)
    sessions.clear()
    earlyOutput.clear()
    earlyClosed.clear()
  }
  return { handle, dispose }
}
