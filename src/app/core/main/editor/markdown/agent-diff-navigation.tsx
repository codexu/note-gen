'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { agentDiffPreviewPluginKey } from './agent-diff-preview-extension'

interface ChangeRegion {
  id: string
  top: number
  bottom: number
  inserted: boolean
  removed: boolean
  elements: HTMLElement[]
}

export function AgentDiffNavigation({ editor, scrollContainerRef }: {
  editor: Editor | null
  scrollContainerRef: { current: HTMLDivElement | null }
}) {
  const t = useTranslations('agentDiffNavigation')
  const [regions, setRegions] = useState<ChangeRegion[]>([])
  const [current, setCurrent] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const [dimensions, setDimensions] = useState({ content: 1, viewport: 0 })
  const currentId = useRef<string | null>(null)
  const highlightCleanup = useRef<(() => void) | null>(null)

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!editor || !container) return
    let frame = 0
    let disposed = false
    let measured: ChangeRegion[] = []

    const updateCurrent = () => {
      const visibleCurrent = measured.findIndex(region => region.id === currentId.current
        && region.bottom >= container.scrollTop
        && region.top <= container.scrollTop + container.clientHeight)
      if (visibleCurrent >= 0) {
        setCurrent(visibleCurrent)
        return
      }
      const center = container.scrollTop + container.clientHeight * 0.3
      let nearest = 0
      let distance = Infinity
      measured.forEach((region, index) => {
        // A tall change remains current while the viewport is inside it.
        const nextDistance = Math.max(region.top - center, center - region.bottom, 0)
        if (nextDistance < distance) {
          distance = nextDistance
          nearest = index
        }
      })
      currentId.current = measured[nearest]?.id ?? null
      setCurrent(nearest)
    }
    const measure = () => {
      frame = 0
      if (disposed || editor.isDestroyed) return
      const active = agentDiffPreviewPluginKey.getState(editor.state)?.active
      if (!active && !measured.length) return
      const groups = new Map<string, ChangeRegion>()
      if (active) {
        const origin = container.getBoundingClientRect().top + container.clientTop
        editor.view.dom.querySelectorAll<HTMLElement>('[data-agent-diff-group]').forEach(element => {
          const rects = Array.from(element.getClientRects()).filter(rect => rect.width || rect.height)
          if (!rects.length) return
          const id = element.dataset.agentDiffGroup!
          const top = Math.min(...rects.map(rect => rect.top)) - origin + container.scrollTop
          const bottom = Math.max(...rects.map(rect => rect.bottom)) - origin + container.scrollTop
          const region = groups.get(id) ?? { id, top, bottom, inserted: false, removed: false, elements: [] }
          region.top = Math.min(region.top, top)
          region.bottom = Math.max(region.bottom, bottom)
          region.inserted ||= element.dataset.agentDiffType === 'inserted'
          region.removed ||= element.dataset.agentDiffType === 'removed'
          region.elements.push(element)
          groups.set(id, region)
        })
      }
      measured = [...groups.values()].sort((a, b) => Number(a.id) - Number(b.id))
      setRegions(measured)
      setDimensions({ content: Math.max(1, container.scrollHeight), viewport: container.clientHeight })
      updateCurrent()
    }
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(container)
    resize.observe(editor.view.dom)
    const mutations = new MutationObserver(schedule)
    mutations.observe(editor.view.dom, { childList: true, subtree: true, characterData: true })
    editor.on('transaction', schedule)
    container.addEventListener('scroll', updateCurrent, { passive: true })
    schedule()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      editor.off('transaction', schedule)
      container.removeEventListener('scroll', updateCurrent)
      highlightCleanup.current?.()
    }
  }, [editor, scrollContainerRef])

  const jumpTo = useCallback((index: number, kind?: 'inserted' | 'removed') => {
    const container = scrollContainerRef.current
    const region = regions[index]
    if (!container || !region) return
    highlightCleanup.current?.()
    region.elements.forEach(element => element.classList.add('agent-diff-navigation-target'))
    const timer = window.setTimeout(() => highlightCleanup.current?.(), 1200)
    highlightCleanup.current = () => {
      window.clearTimeout(timer)
      region.elements.forEach(element => element.classList.remove('agent-diff-navigation-target'))
      highlightCleanup.current = null
    }
    currentId.current = region.id
    const target = kind ? region.elements.find(element => element.dataset.agentDiffType === kind) : undefined
    const targetTop = target
      ? target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      : region.top
    container.scrollTo({
      top: Math.max(0, targetTop - container.clientHeight * 0.3),
      behavior: 'instant',
    })
    setCurrent(index)
    const changeKind = region.inserted && region.removed ? 'replaced' : region.inserted ? 'inserted' : 'removed'
    setAnnouncement(`${t('position', { current: index + 1, total: regions.length })} · ${t(kind ?? changeKind)}`)
  }, [regions, scrollContainerRef, t])

  useEffect(() => {
    const shell = scrollContainerRef.current?.closest('.tiptap-editor')
    if (!shell || !regions.length) return
    const handleKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || !event.altKey || event.ctrlKey || event.metaKey
        || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const index = regions.findIndex(region => region.id === currentId.current)
      jumpTo(Math.max(0, Math.min(regions.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
    }
    shell.addEventListener('keydown', handleKeyDown)
    return () => shell.removeEventListener('keydown', handleKeyDown)
  }, [jumpTo, regions, scrollContainerRef])

  if (!regions.length) return null

  return (
    <>
      <div role="group" aria-label={t('label')} className="agent-diff-navigation-bar absolute right-6 top-2 z-40 inline-flex max-w-[calc(100%-3rem)] flex-wrap items-center gap-1 rounded-md border p-1 font-sans shadow-sm">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('previous')} aria-keyshortcuts="Alt+ArrowUp" title={`${t('previous')} (Alt+↑)`} disabled={current === 0} onClick={() => jumpTo(current - 1)}>
          <ChevronUp />
        </Button>
        <span className="px-1 text-xs font-normal tabular-nums">
          {t('position', { current: current + 1, total: regions.length })}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('next')} aria-keyshortcuts="Alt+ArrowDown" title={`${t('next')} (Alt+↓)`} disabled={current === regions.length - 1} onClick={() => jumpTo(current + 1)}>
          <ChevronDown />
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={!regions[current]?.removed} onClick={() => jumpTo(current, 'removed')}>{t('before')}</Button>
        <Button type="button" variant="ghost" size="xs" disabled={!regions[current]?.inserted} onClick={() => jumpTo(current, 'inserted')}>{t('after')}</Button>
      </div>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</span>
      {dimensions.content > dimensions.viewport && (
        <div role="group" aria-label={t('label')} className="agent-diff-overview pointer-events-none absolute inset-y-0 right-3 z-30 w-3">
          {regions.map((region, index) => {
            const height = Math.min(dimensions.viewport, Math.max(8, (region.bottom - region.top) / dimensions.content * dimensions.viewport))
            const top = Math.max(0, Math.min(dimensions.viewport - height, region.top / dimensions.content * dimensions.viewport))
            const kind = region.inserted && region.removed ? 'replaced' : region.inserted ? 'inserted' : 'removed'
            const label = `${t('jump', { index: index + 1 })} · ${t(kind)}`
            return (
              <button type="button" key={region.id} aria-label={label} title={label} aria-current={current === index ? 'location' : undefined} tabIndex={-1} onClick={() => jumpTo(index)} className="agent-diff-map-marker pointer-events-auto absolute inset-x-0 flex cursor-pointer overflow-hidden" style={{ top, height }}>
                {region.removed && <span className="agent-diff-map-removed h-full flex-1" />}
                {region.inserted && <span className="agent-diff-map-inserted h-full flex-1" />}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
