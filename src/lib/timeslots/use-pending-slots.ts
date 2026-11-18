'use client'

import { useMemo } from 'react'
import { useDecisions } from '@/lib/decide/use-decisions'
import useCollectStore from '@/stores/collect'

/** Scheduler slots available for review on the given date. The queue remains the visibility authority. */
export function usePendingSlots(date: string) {
  const captures = useCollectStore(state => state.items)
  const decisions = useDecisions()
  return useMemo(() => {
    const visible = new Set(decisions.map(item => item.key))
    return captures.flatMap(item => item.proposals.flatMap(proposal => {
      const key = `collect:${item.id}:${proposal.id}`
      return proposal.slot && proposal.due === date && visible.has(key)
        ? [{ key, title: proposal.title, due: proposal.due, time: proposal.time }]
        : []
    }))
  }, [captures, decisions, date])
}
