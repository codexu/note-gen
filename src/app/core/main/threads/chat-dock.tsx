'use client'

// Fork（almanac ALMNC-14）：讓「右側欄那一份」對話面板在對話頁裡顯示，而不是再掛第二份。
// 對話面板（Chat）裡有輸入框、剪貼簿監聽、審批與修改比對，全域只能有一份。這裡把它畫進一個固定的 div，
// 平常這個 div 放在右側欄；對話頁開著時，把這個 div 搬到對話頁的位置（DOM 搬移，React 子樹不會重新掛載，
// 所以輸入中的草稿、正在跑的 Agent 都不受影響）。對話頁關掉再搬回來。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import useThreadsStore from '@/stores/threads'

export function ChatDock({ children }: { children: ReactNode }) {
  const home = useRef<HTMLDivElement>(null)
  const [dock, setDock] = useState<HTMLDivElement | null>(null)
  const host = useThreadsStore(state => state.chatHost)

  useEffect(() => {
    const el = document.createElement('div')
    el.className = 'h-full min-h-0'
    setDock(el)
    return () => el.remove()
  }, [])

  useEffect(() => {
    const target = host ?? home.current
    if (dock && target && dock.parentElement !== target) target.appendChild(dock)
  }, [dock, host])

  return <div ref={home} className="h-full min-h-0">{dock ? createPortal(children, dock) : null}</div>
}
