'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { captureWikiWorkspaceGuard } from '@/lib/wiki/context'

/** Keep an action tied to one workspace visit, including an A → B → A switch. */
export function useWikiActionScope(scopeKey: string) {
  const mounted = useRef(true)
  const scope = useRef({ key: scopeKey, token: Symbol() })
  if (scope.current.key !== scopeKey) {
    scope.current = { key: scopeKey, token: Symbol() }
  }
  const [pending, setPending] = useState<{ isCurrent: () => boolean; request: symbol } | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      scope.current = { ...scope.current, token: Symbol() }
    }
  }, [])

  const getActionGuard = useCallback(() => {
    const token = scope.current.token
    const workspaceIsCurrent = captureWikiWorkspaceGuard()
    return () => mounted.current && scope.current.token === token
      && workspaceIsCurrent()
  }, [])

  const beginAction = useCallback(() => {
    const isCurrent = getActionGuard()
    const request = Symbol()
    setPending({ isCurrent, request })
    return {
      isCurrent,
      finish: () => {
        if (isCurrent()) setPending(current => current?.request === request ? null : current)
      },
    }
  }, [getActionGuard])

  return { busy: pending?.isCurrent() ?? false, beginAction, getActionGuard }
}
