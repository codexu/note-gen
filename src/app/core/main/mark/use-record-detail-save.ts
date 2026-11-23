'use client'

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getMarkById, type Mark } from '@/db/marks'
import useMarkStore from '@/stores/mark'
import {
  canEditRecordDescription,
  getRecordBodyMarkdown,
  patchTodoMarkContent,
  replaceRecordBodyMarkdown,
} from './mark-list-item-content'

type SaveStatus = 'idle' | 'pending' | 'saving' | 'failed'
type RecordChange = (latest: Mark) => Mark

interface QueuedChange {
  apply: RecordChange
  waiters: Array<(saved: boolean) => void>
}

const recordWrites = new Map<number, Promise<void>>()

async function enqueueRecordWrite<T>(id: number, run: () => Promise<T>): Promise<T> {
  // A pane can remount while its previous instance is still saving.
  const write = (recordWrites.get(id) ?? Promise.resolve()).then(run)
  const settled = write.then(() => undefined, () => undefined)
  recordWrites.set(id, settled)
  try {
    return await write
  } finally {
    if (recordWrites.get(id) === settled) recordWrites.delete(id)
  }
}

function writeChanges(id: number, batch: QueuedChange[]) {
  return enqueueRecordWrite(id, async () => {
    const latest = await getMarkById(id)
    if (!latest || latest.deleted === 1) throw new Error('Record is unavailable for editing')

    const next = batch.reduce((current, change) => change.apply(current), latest)
    await useMarkStore.getState().updateMark(next, { optimistic: false })
    return next
  })
}

export async function readRecordAfterPendingWrites(id: number) {
  await recordWrites.get(id)
  return await getMarkById(id)
}

export function setRecordTodoCompleted(id: number, completed: boolean): Promise<boolean> {
  return enqueueRecordWrite(id, async () => {
    // Read the full record because list previews can shorten its notes.
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await getMarkById(id)
      if (!latest || latest.deleted === 1 || latest.type !== 'todo') return false

      const next = patchTodoMarkContent(latest, { completed })
      if (await useMarkStore.getState().updateMarkIfCurrent(next, latest)) return true
    }
    return false
  })
}

export function saveRecordDescription(id: number, expected: string | undefined, description: string) {
  return enqueueRecordWrite(id, async () => {
    // Rebase once if a concurrent update changed another field after the read.
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await getMarkById(id)
      if (!latest || !canEditRecordDescription(latest) || (latest.desc ?? null) !== (expected ?? null)) return null
      if ((latest.desc ?? '') === description) return latest

      const next = { ...latest, desc: description }
      if (await useMarkStore.getState().updateMarkIfCurrent(next, latest)) return next
    }
    return null
  })
}

export function commitRecordImageAsset(original: Mark, filename: string) {
  return enqueueRecordWrite(original.id, async () => {
    // Rebase once if a concurrent update changed another field after the read.
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await getMarkById(original.id)
      if (!latest || latest.deleted || latest.type !== original.type || latest.url !== original.url
        || (original.sourceId && latest.sourceId !== original.sourceId)) return null

      const next = { ...latest, url: filename }
      if (await useMarkStore.getState().updateMarkIfCurrent(next, latest, { retainPreviousAssets: true })) return next
    }
    return null
  })
}

function resolveChanges(batch: QueuedChange[], saved: boolean) {
  for (const change of batch) {
    for (const resolve of change.waiters.splice(0)) resolve(saved)
  }
}

export function useRecordDetailSave(mark: Mark, onCommitted?: (mark: Mark) => void) {
  const { id, deleted } = mark
  const queue = useRef<QueuedChange[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(false)
  const abandoned = useRef(false)
  const writing = useRef(false)
  const statusRef = useRef<SaveStatus>('idle')
  const onCommittedRef = useRef(onCommitted)
  onCommittedRef.current = onCommitted
  const [state, setState] = useState<{ status: SaveStatus; pending: QueuedChange[] }>({ status: 'idle', pending: [] })

  const publish = useCallback((status: SaveStatus) => {
    statusRef.current = status
    if (mounted.current) setState({ status, pending: queue.current })
  }, [])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const flush = useCallback(async () => {
    if (writing.current || !queue.current.length) return
    writing.current = true
    publish('saving')

    try {
      while (queue.current.length && timer.current === null) {
        const batch = queue.current
        const saved = await writeChanges(id, batch)
        queue.current = queue.current.slice(batch.length)
        if (mounted.current) onCommittedRef.current?.(saved)
        resolveChanges(batch, true)
      }
      publish(queue.current.length ? 'pending' : 'idle')
    } catch (error) {
      console.error('Failed to save the record:', error)
      clearTimer()
      publish('failed')
      resolveChanges(queue.current, false)
    } finally {
      writing.current = false
    }
  }, [clearTimer, id, publish])

  const schedule = useCallback((debounce = false) => {
    clearTimer()
    publish(writing.current ? 'saving' : 'pending')

    if (debounce && mounted.current) {
      timer.current = setTimeout(() => {
        timer.current = null
        void flush()
      }, 500)
    } else {
      void flush()
    }
  }, [clearTimer, flush, publish])

  useLayoutEffect(() => {
    mounted.current = true
    abandoned.current = false

    return () => {
      mounted.current = false
      clearTimer()
      if (statusRef.current === 'failed') {
        // A failed draft can be explicitly discarded when closing its tab.
        abandoned.current = true
        queue.current = []
      } else {
        void flush()
      }
    }
  }, [clearTimer, flush])

  const save = useCallback((apply: RecordChange, options?: { debounce?: boolean }) => {
    if (deleted === 1 || abandoned.current) return Promise.resolve(false)

    return new Promise<boolean>(resolve => {
      queue.current = [...queue.current, { apply, waiters: [resolve] }]
      schedule(options?.debounce)
    })
  }, [deleted, schedule])

  const retry = useCallback(() => {
    const last = queue.current.at(-1)
    if (!last) return Promise.resolve(!abandoned.current)

    return new Promise<boolean>(resolve => {
      last.waiters.push(resolve)
      schedule()
    })
  }, [schedule])

  const replaceBodyIfUnchanged = useCallback(async (before: string, after: string, isCurrent: () => boolean, expectedImageUrl?: string) => {
    if (!await retry() || !isCurrent()) return false

    return await enqueueRecordWrite(id, async () => {
      const latest = await getMarkById(id)
      if (!isCurrent() || !latest || latest.deleted || getRecordBodyMarkdown(latest) !== before) return false
      if (expectedImageUrl !== undefined && latest.url !== expectedImageUrl) return false
      const next = replaceRecordBodyMarkdown(latest, after)
      if (!await useMarkStore.getState().updateMarkIfCurrent(next, latest)) return false
      if (mounted.current) onCommittedRef.current?.(next)
      return true
    })
  }, [id, retry])

  const draft = useMemo(() => state.pending.reduce((current, change) => change.apply(current), mark), [mark, state.pending])
  const getStatus = useCallback(() => statusRef.current, [])

  return { draft, status: state.status, save, retry, getStatus, replaceBodyIfUnchanged }
}
