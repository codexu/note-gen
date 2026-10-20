'use client'

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'

import { executeLocalMcpTool } from '@/lib/local-mcp/tools'
import type { LocalMcpBridgeRequest } from '@/lib/local-mcp/types'

export function LocalMcpBridge() {
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    async function start() {
      unlisten = await listen<LocalMcpBridgeRequest>('local-mcp://request', event => {
        const request = event.payload
        void (async () => {
          try {
            const result = await executeLocalMcpTool(request.toolName, request.arguments)
            await invoke('resolve_local_mcp_request', {
              body: { requestId: request.requestId, result },
            })
          } catch (error) {
            try {
              await invoke('resolve_local_mcp_request', {
                body: {
                  requestId: request.requestId,
                  error: {
                    code: 'bridge_error',
                    message: error instanceof Error ? error.message : String(error),
                  },
                },
              })
            } catch (resolveError) {
              console.warn('Failed to resolve local MCP request:', resolveError)
            }
          }
        })()
      })
      await invoke('set_local_mcp_ready', { ready: true })
      if (disposed) {
        unlisten?.()
        await invoke('set_local_mcp_ready', { ready: false })
      }
    }

    void start()
    return () => {
      disposed = true
      unlisten?.()
      void invoke('set_local_mcp_ready', { ready: false })
    }
  }, [])

  return null
}
