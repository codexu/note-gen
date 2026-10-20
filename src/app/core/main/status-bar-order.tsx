'use client'

import { useEffect, type DragEvent, type ReactNode } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { motion } from 'framer-motion'
import { create } from 'zustand'

import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const ORDER_KEY = 'mainStatusBarOrder'
const LEGACY_PLUGIN_ORDER_KEY = 'pluginStatusBarOrder'

type Entry = { id: string; rank: number }
type StatusBarOrderState = {
  entries: Record<string, Entry>
  savedOrder: string[]
  previewOrder: string[] | null
  legacyPluginOrder: string[]
  dragging: string | null
  over: string | null
  overAfter: boolean
  register: (entry: Entry) => void
  unregister: (id: string) => void
  load: () => Promise<void>
  start: (id: string) => void
  hover: (id: string, after: boolean) => void
  end: () => void
  drop: (id: string, after: boolean) => Promise<void>
}

let loadPromise: Promise<void> | null = null
let savePromise: Promise<void> = Promise.resolve()

function orderedIds(state: StatusBarOrderState) {
  const entries = Object.values(state.entries)
  const defaults = entries.sort((a, b) => {
    const aLegacy = state.legacyPluginOrder.indexOf(a.id)
    const bLegacy = state.legacyPluginOrder.indexOf(b.id)
    if (aLegacy >= 0 && bLegacy >= 0) return aLegacy - bLegacy
    return a.rank - b.rank || a.id.localeCompare(b.id)
  }).map(entry => entry.id)
  const preferredOrder = state.previewOrder ?? state.savedOrder
  if (!preferredOrder.length) return defaults
  const visible = new Set(defaults)
  const ordered = preferredOrder.filter(id => visible.has(id))
  for (const id of defaults) {
    if (ordered.includes(id)) continue
    const rank = state.entries[id].rank
    const before = ordered.findIndex(other => state.entries[other].rank > rank)
    ordered.splice(before < 0 ? ordered.length : before, 0, id)
  }
  return ordered
}

function movedOrder(state: StatusBarOrderState, active: string, target: string, after: boolean) {
  const current = orderedIds({ ...state, previewOrder: null })
  const full = [...state.savedOrder]
  for (const key of current) {
    if (full.includes(key)) continue
    const nextSaved = current.slice(current.indexOf(key) + 1).find(other => full.includes(other))
    full.splice(nextSaved ? full.indexOf(nextSaved) : full.length, 0, key)
  }
  const moved = full.filter(key => key !== active)
  const targetIndex = moved.indexOf(target)
  if (targetIndex < 0) return null
  moved.splice(targetIndex + (after ? 1 : 0), 0, active)
  return moved
}

export const useStatusBarOrder = create<StatusBarOrderState>((set, get) => ({
  entries: {},
  savedOrder: [],
  previewOrder: null,
  legacyPluginOrder: [],
  dragging: null,
  over: null,
  overAfter: false,
  register: entry => set(state => state.entries[entry.id]?.rank === entry.rank ? state : {
    entries: { ...state.entries, [entry.id]: entry },
  }),
  unregister: id => set(state => {
    if (!state.entries[id]) return state
    const entries = { ...state.entries }
    delete entries[id]
    return { entries }
  }),
  load: async () => {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const store = await Store.load('store.json')
        const saved = await store.get<string[]>(ORDER_KEY)
        if (Array.isArray(saved)) {
          set({ savedOrder: saved.filter(id => typeof id === 'string') })
          return
        }
        const legacy = await store.get<string[]>(LEGACY_PLUGIN_ORDER_KEY)
        if (Array.isArray(legacy) && legacy.length) {
          set({ legacyPluginOrder: legacy.filter(id => typeof id === 'string') })
        }
      } catch (error) {
        console.warn('[status-bar] Could not load tool order', error)
      }
    })()
    return loadPromise
  },
  start: id => set({ dragging: id, previewOrder: null }),
  hover: (id, after) => set(state => {
    if (!state.dragging || state.dragging === id || (state.over === id && state.overAfter === after)) return state
    const previewOrder = movedOrder(state, state.dragging, id, after)
    return previewOrder ? { over: id, overAfter: after, previewOrder } : state
  }),
  end: () => set({ dragging: null, over: null, previewOrder: null }),
  drop: async (id, after) => {
    const state = get()
    const active = state.dragging
    if (!active) return
    const savedOrder = active === id ? state.previewOrder : movedOrder(state, active, id, after)
    if (!savedOrder) { state.end(); return }
    set({ savedOrder, dragging: null, over: null, previewOrder: null })
    savePromise = savePromise.catch(() => {}).then(async () => {
      const store = await Store.load('store.json')
      await store.set(ORDER_KEY, savedOrder)
      await store.save()
    })
    try { await savePromise } catch (error) {
      console.warn('[status-bar] Could not save tool order', error)
      if (get().savedOrder === savedOrder) set({ savedOrder: state.savedOrder })
      toast({ description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    }
  },
}))

function usePosition(id: string, rank: number) {
  const register = useStatusBarOrder(state => state.register)
  const unregister = useStatusBarOrder(state => state.unregister)
  const position = useStatusBarOrder(state => orderedIds(state).indexOf(id))
  useEffect(() => {
    register({ id, rank })
    return () => unregister(id)
  }, [id, rank, register, unregister])
  return position < 0 ? rank * 100 : position
}

function dropAfter(event: DragEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientX >= rect.left + rect.width / 2
}

export function StatusBarItem({ id, rank, children, className }: {
  id: string
  rank: number
  children: ReactNode
  className?: string
}) {
  const order = usePosition(id, rank)
  const dragging = useStatusBarOrder(state => state.dragging)
  const over = useStatusBarOrder(state => state.over)
  const overAfter = useStatusBarOrder(state => state.overAfter)
  const start = useStatusBarOrder(state => state.start)
  const hover = useStatusBarOrder(state => state.hover)
  const end = useStatusBarOrder(state => state.end)
  const drop = useStatusBarOrder(state => state.drop)
  return <motion.div
    layout="position"
    layoutDependency={order}
    transition={{ layout: { type: 'spring', stiffness: 520, damping: 42 } }}
    style={{ order }}
    className={cn('flex h-full shrink-0 items-center', dragging === id && 'opacity-40', dragging && over === id && (overAfter ? 'border-r-2 border-primary' : 'border-l-2 border-primary'))}
  ><div
      draggable
      className={cn('flex h-full cursor-grab select-none items-center active:cursor-grabbing', className)}
      onDragStart={event => {
        if (event.target instanceof Element && event.target.closest('input, textarea, [role="slider"], [contenteditable="true"]')) {
          event.preventDefault()
          return
        }
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', id)
        start(id)
      }}
      onDragEnd={end}
      onDragOver={event => {
        if (!dragging) return
        event.preventDefault()
        if (dragging === id) return
        hover(id, dropAfter(event))
      }}
      onDrop={event => {
        event.preventDefault()
        void drop(id, dropAfter(event))
      }}
    >{children}</div></motion.div>
}

export function StatusBarSpacer({ id, rank }: { id: string; rank: number }) {
  const order = usePosition(id, rank)
  const dragging = useStatusBarOrder(state => state.dragging)
  const over = useStatusBarOrder(state => state.over)
  const overAfter = useStatusBarOrder(state => state.overAfter)
  const hover = useStatusBarOrder(state => state.hover)
  const drop = useStatusBarOrder(state => state.drop)
  return <motion.div
    layout="position"
    layoutDependency={order}
    transition={{ layout: { type: 'spring', stiffness: 520, damping: 42 } }}
    style={{ order }}
    className={cn('h-full min-w-2 flex-1', dragging && over === id && (overAfter ? 'border-r-2 border-primary' : 'border-l-2 border-primary'))}
    aria-hidden="true"
    onDragOver={event => { if (dragging) { event.preventDefault(); hover(id, dropAfter(event)) } }}
    onDrop={event => { event.preventDefault(); void drop(id, dropAfter(event)) }}
  />
}
