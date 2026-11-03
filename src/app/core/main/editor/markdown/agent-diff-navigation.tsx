'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  navigationHost?: HTMLElement
}

export function AgentDiffNavigation({ editor, scrollContainerRef }: {
  editor: Editor | null
  scrollContainerRef: { current: HTMLDivElement | null }
}) {
  const t = useTranslations('agentDiffNavigation')
  const [regions, setRegions] = useState<ChangeRegion[]>([])
  const [current, setCurrent] = useState(0)
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
      for (const region of measured) {
        region.navigationHost = editor.view.dom.querySelector<HTMLElement>(
          `[data-agent-diff-navigation="${region.id}"]`
        ) ?? undefined
      }
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

  const jumpTo = (index: number) => {
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
    container.scrollTo({
      top: Math.max(0, region.top - container.clientHeight * 0.3),
      behavior: 'instant',
    })
    setCurrent(index)
  }

  if (!regions.length) return null

  return (
    <>
      {regions.length > 1 && regions.map((region, index) => region.navigationHost && createPortal(
        <span role="group" aria-label={t('label')} className="agent-diff-navigation-bar inline-flex max-w-full items-center gap-1 rounded-md border p-0.5 font-sans shadow-sm" onMouseDown={event => event.preventDefault()}>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('previous')} title={t('previous')} disabled={index === 0} onClick={() => jumpTo(index - 1)}>
            <ChevronUp />
          </Button>
          <span className="px-1 text-xs font-normal tabular-nums">
            {t('position', { current: index + 1, total: regions.length })}
          </span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('next')} title={t('next')} disabled={index === regions.length - 1} onClick={() => jumpTo(index + 1)}>
            <ChevronDown />
          </Button>
        </span>, region.navigationHost, region.id
      ))}
      {dimensions.content > dimensions.viewport && (
        <div role="group" aria-label={t('label')} className="agent-diff-overview pointer-events-none absolute inset-y-0 right-0 z-30 w-3">
          {regions.map((region, index) => {
            const height = Math.min(dimensions.viewport, Math.max(3, (region.bottom - region.top) / dimensions.content * dimensions.viewport))
            const top = Math.max(0, Math.min(dimensions.viewport - height, region.top / dimensions.content * dimensions.viewport))
            const kind = region.inserted && region.removed ? 'replaced' : region.inserted ? 'inserted' : 'removed'
            const label = `${t('jump', { index: index + 1 })} · ${t(kind)}`
            return (
              <span key={region.id} aria-label={label} aria-current={current === index ? 'location' : undefined} className="agent-diff-map-marker absolute inset-x-0 flex overflow-hidden" style={{ top, height }}>
                {region.removed && <span className="agent-diff-map-removed h-full flex-1" />}
                {region.inserted && <span className="agent-diff-map-inserted h-full flex-1" />}
              </span>
            )
          })}
        </div>
      )}
    </>
  )
}
