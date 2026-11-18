'use client'

// Fork（almanac P0-c）：命令面板的選中底用 framer-motion layoutId 在項目間滑動（spring 360/32/0.6）。
// cmdk 在選中的項目上設 data-selected；這裡用 MutationObserver 讀它，不必知道項目的 value。
// 只在 Dialog 裡的面板啟用（彈出式選單維持上游的靜態選中底）。
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'

const ScopeContext = createContext<string | null>(null)

export function CommandHighlightScope({ children }: { children: ReactNode }) {
  const id = useId()
  return (
    <ScopeContext.Provider value={id}>
      <LayoutGroup id={id}>{children}</LayoutGroup>
    </ScopeContext.Provider>
  )
}

export function CommandItemHighlight() {
  const scope = useContext(ScopeContext)
  const reduce = useReducedMotion()
  const marker = useRef<HTMLSpanElement>(null)
  const [selected, setSelected] = useState(false)
  const [inDialog, setInDialog] = useState(false)

  useEffect(() => {
    const item = marker.current?.parentElement
    if (!item) return
    setInDialog(Boolean(item.closest('[data-slot="dialog-content"]')))
    const read = () => setSelected(item.getAttribute('data-selected') === 'true')
    read()
    const observer = new MutationObserver(read)
    observer.observe(item, { attributes: true, attributeFilter: ['data-selected'] })
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <span ref={marker} hidden />
      {scope && inDialog && selected ? (
        <motion.span
          layoutId="command-highlight"
          aria-hidden
          className="absolute inset-0 -z-10 rounded-md bg-active"
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 32, mass: 0.6 }}
        />
      ) : null}
    </>
  )
}
