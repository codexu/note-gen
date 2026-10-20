'use client'

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { Image as TauriImage } from '@tauri-apps/api/image'
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window'
import { writeImage } from '@tauri-apps/plugin-clipboard-manager'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { Check, Copy, Download, NotebookPen, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ThemeProvider } from '@/components/theme-provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { listenTauriEvent } from '@/lib/tauri-event-listener'
import { cn } from '@/lib/utils'

type RecordState = 'unsaved' | 'pending' | 'saved'

interface RecordStateEvent {
  pinId: string
  recordState: RecordState
}

interface PinnedScreenshotContext {
  pinId: string
  imagePath: string
  imageWidth: number
  imageHeight: number
  scaleFactor: number
  platform: 'macos' | 'windows' | 'linux'
  recordState: RecordState
}

function ActionButton({ label, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export default function ScreenshotPinPage() {
  const t = useTranslations('screenshotPin')
  const [context, setContext] = useState<PinnedScreenshotContext | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [recordState, setRecordState] = useState<RecordState>('unsaved')
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const imageAreaRef = useRef<HTMLDivElement>(null)
  const contextRef = useRef<PinnedScreenshotContext | null>(null)
  const zoomRef = useRef(1)
  const requestedZoomRef = useRef(1)
  const busyRef = useRef(false)
  const resizingRef = useRef(false)
  const pendingZoomRef = useRef<number | null>(null)
  const readyRef = useRef(false)
  const mountedRef = useRef(false)
  const recordStateRef = useRef<RecordState>('unsaved')
  const recordEventVersionRef = useRef(0)
  const lastRecordEventRef = useRef<RecordStateEvent | null>(null)

  const showWindow = useCallback(async () => {
    if (readyRef.current) return
    readyRef.current = true
    try {
      await invoke('ready_pinned_screenshot')
    } catch (cause) {
      readyRef.current = false
      console.error('Unable to show pinned screenshot:', cause)
      if (mountedRef.current) setError(t('loadError'))
    }
  }, [t])

  const close = useCallback(async () => {
    if (busyRef.current) return
    try {
      await getCurrentWindow().close()
    } catch (cause) {
      console.error('Unable to close pinned screenshot:', cause)
      if (mountedRef.current) setError(t('actionError'))
    }
  }, [t])

  const updateZoom = useCallback(() => {
    const current = contextRef.current
    if (!current) return
    const sourceScale = current.scaleFactor > 0 ? current.scaleFactor : 1
    const area = imageAreaRef.current
    const next = Math.min(
      requestedZoomRef.current,
      (area?.clientWidth || window.innerWidth) / (current.imageWidth / sourceScale),
      Math.max(1, area?.clientHeight || window.innerHeight) / (current.imageHeight / sourceScale),
    )
    zoomRef.current = next
    setZoom(next)
  }, [])

  const resize = useCallback((nextZoom: number) => {
    if (busyRef.current || !contextRef.current) return
    pendingZoomRef.current = nextZoom
    if (resizingRef.current) return
    resizingRef.current = true
    void (async () => {
      try {
        while (pendingZoomRef.current !== null && mountedRef.current) {
          const requested = pendingZoomRef.current
          pendingZoomRef.current = null
          const current = contextRef.current
          if (!current) break
          const monitor = await currentMonitor()
          const sourceScale = current.scaleFactor > 0 ? current.scaleFactor : 1
          const width = current.imageWidth / sourceScale
          const height = current.imageHeight / sourceScale
          const monitorScale = monitor?.scaleFactor || window.devicePixelRatio || 1
          const maximumWidth = (monitor?.workArea.size.width || window.screen.availWidth * monitorScale) / monitorScale * 0.95
          const maximumHeight = (monitor?.workArea.size.height || window.screen.availHeight * monitorScale) / monitorScale * 0.95
          const maximumZoom = Math.max(0.01, Math.min(8, (maximumWidth - 2) / width, (maximumHeight - 2) / height))
          const clamped = Math.min(maximumZoom, Math.max(Math.min(0.1, maximumZoom), requested))
          const pinWindow = getCurrentWindow()
          const position = await pinWindow.outerPosition()
          requestedZoomRef.current = clamped
          zoomRef.current = clamped
          await pinWindow.setSize(new LogicalSize(
            Math.max(280, Math.round(width * clamped + 2)),
            Math.max(120, Math.round(height * clamped + 2)),
          ))
          if (monitor) {
            const size = await pinWindow.outerSize()
            const area = monitor.workArea
            // Keep a growing pin inside the work area, away from the menu bar and Dock/taskbar.
            const x = Math.max(area.position.x, Math.min(position.x, area.position.x + area.size.width - size.width))
            const y = Math.max(area.position.y, Math.min(position.y, area.position.y + area.size.height - size.height))
            if (x !== position.x || y !== position.y) await pinWindow.setPosition(new PhysicalPosition(x, y))
          }
          if (mountedRef.current) updateZoom()
        }
      } catch (cause) {
        console.error('Unable to resize pinned screenshot:', cause)
        if (mountedRef.current) setError(t('actionError'))
      } finally {
        pendingZoomRef.current = null
        resizingRef.current = false
      }
    })()
  }, [t, updateZoom])

  const changeZoom = useCallback((factor: number) => {
    resize((pendingZoomRef.current ?? zoomRef.current) * factor)
  }, [resize])

  const performAction = useCallback(async (action: 'copy' | 'save' | 'record') => {
    if (!loaded || busyRef.current || (action === 'record' && recordStateRef.current === 'saved')) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      if (action === 'record') {
        const version = recordEventVersionRef.current
        const nextState = await invoke<'pending' | 'saved'>('save_pinned_screenshot')
        // The main window can acknowledge or reject the queued record before this reply arrives.
        if (mountedRef.current && recordEventVersionRef.current === version) {
          recordStateRef.current = nextState
          setRecordState(nextState)
        }
        return
      }
      // The native command only reads the PNG belonging to this pin window.
      const png = new Uint8Array(await invoke<ArrayBuffer>('read_pinned_screenshot'))
      if (action === 'copy') {
        const image = await TauriImage.fromBytes(png)
        try { await writeImage(image) } finally { await image.close() }
        if (mountedRef.current) setCopied(true)
      } else {
        const filename = `NoteGen-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
        const path = await save({ defaultPath: filename, filters: [{ name: 'PNG', extensions: ['png'] }] })
        if (path) await writeFile(path, png)
      }
    } catch (cause) {
      console.error('Pinned screenshot action failed:', cause)
      if (mountedRef.current && (action !== 'record' || recordStateRef.current !== 'saved')) {
        setError(t(action === 'record' ? 'recordSaveFailed' : 'actionError'))
      }
    } finally {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  }, [loaded, t])

  useEffect(() => {
    mountedRef.current = true
    document.documentElement.style.fontSize = '100%'
    let disposed = false
    let unlisten: UnlistenFn | undefined
    void (async () => {
      try {
        const stop = await listenTauriEvent<RecordStateEvent>('pinned-screenshot-record-state', ({ payload }) => {
          const current = contextRef.current
          if (disposed || !mountedRef.current || (current && current.pinId !== payload.pinId)) return
          if (recordStateRef.current === 'saved' && payload.recordState !== 'saved') return
          lastRecordEventRef.current = payload
          recordEventVersionRef.current += 1
          recordStateRef.current = payload.recordState
          setRecordState(payload.recordState)
          if (payload.recordState === 'unsaved') setError(t('recordSaveFailed'))
          else setError('')
        }, { kind: 'Window', label: getCurrentWindow().label })
        if (disposed) {
          stop()
          return
        }
        unlisten = stop
        const value = await invoke<PinnedScreenshotContext>('get_pinned_screenshot')
        if (disposed) return
        contextRef.current = value
        const lastEvent = lastRecordEventRef.current
        const nextState = lastEvent?.pinId === value.pinId ? lastEvent.recordState : value.recordState
        recordStateRef.current = nextState
        setRecordState(nextState)
        setContext(value)
        updateZoom()
      } catch (cause) {
        console.error('Unable to load pinned screenshot:', cause)
        if (disposed) return
        setError(t('loadError'))
        void showWindow()
      }
    })()
    window.addEventListener('resize', updateZoom)
    return () => {
      mountedRef.current = false
      disposed = true
      unlisten?.()
      pendingZoomRef.current = null
      window.removeEventListener('resize', updateZoom)
    }
  }, [showWindow, t, updateZoom])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    const element = imageAreaRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (!loaded || busyRef.current || event.deltaY === 0) return
      changeZoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [changeZoom, loaded])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        void close()
        return
      }
      if (busyRef.current || !loaded || !(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'c' || key === 's') {
        event.preventDefault()
        event.stopPropagation()
        void performAction(key === 'c' ? 'copy' : 'save')
      } else if (key === '+' || key === '=') {
        event.preventDefault()
        changeZoom(1.1)
      } else if (key === '-') {
        event.preventDefault()
        changeZoom(1 / 1.1)
      } else if (key === '0') {
        event.preventDefault()
        resize(1)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [changeZoom, close, loaded, performAction, resize])

  const dragWindow = () => {
    if (busyRef.current) return
    void getCurrentWindow().startDragging().catch(cause => {
      console.error('Unable to move pinned screenshot:', cause)
      if (mountedRef.current) setError(t('actionError'))
    })
  }

  const sourceScale = context && context.scaleFactor > 0 ? context.scaleFactor : 1

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <main className="fixed inset-0 flex overflow-hidden border bg-background text-foreground select-none" aria-label={t('title')} aria-busy={busy}
        onPointerEnter={() => setToolbarVisible(true)} onPointerLeave={() => setToolbarVisible(false)}
        onFocusCapture={event => { if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) setToolbarVisible(true) }}>
        <div role="toolbar" aria-label={t('title')} className={cn('absolute inset-x-0 top-0 z-20 flex h-11 items-center gap-1 border-b bg-background/95 px-1 transition-opacity', toolbarVisible ? 'opacity-100' : 'pointer-events-none opacity-0')}
          onContextMenu={event => event.preventDefault()} onPointerDown={event => {
            if (event.button !== 0 || busyRef.current || !(event.target instanceof Element) || event.target.closest('button')) return
            event.preventDefault()
            dragWindow()
          }}>
          <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div className="flex min-w-max items-center gap-1">
              <ActionButton label={t(recordState === 'saved' ? 'recordSaved' : recordState === 'pending' ? 'savingRecord' : 'saveRecord')} disabled={!loaded || busy || recordState === 'saved'} onClick={() => void performAction('record')}>
                {recordState === 'saved' ? <Check data-icon="inline-start" /> : recordState === 'pending' ? <Spinner aria-label={t('savingRecord')} /> : <NotebookPen data-icon="inline-start" />}
              </ActionButton>
              <ActionButton label={t('copy')} disabled={!loaded || busy} onClick={() => void performAction('copy')}>
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              </ActionButton>
              <ActionButton label={t('save')} disabled={!loaded || busy} onClick={() => void performAction('save')}><Download data-icon="inline-start" /></ActionButton>
              <ActionButton label={t('zoomOut')} disabled={!loaded || busy} onClick={() => changeZoom(1 / 1.1)}><ZoomOut data-icon="inline-start" /></ActionButton>
              <ActionButton label={t('resetZoom')} disabled={!loaded || busy} onClick={() => resize(1)}><RotateCcw data-icon="inline-start" /></ActionButton>
              <ActionButton label={t('zoomIn')} disabled={!loaded || busy} onClick={() => changeZoom(1.1)}><ZoomIn data-icon="inline-start" /></ActionButton>
              <span className="px-1 text-xs tabular-nums" aria-label={t('zoomLabel', { percent: Math.round(zoom * 100) })}>{Math.round(zoom * 100)}%</span>
              {busy && <Spinner aria-label={t('loading')} />}
            </div>
          </div>
          <ActionButton label={t('close')} className="shrink-0" disabled={busy} onClick={() => void close()}><X data-icon="inline-start" /></ActionButton>
        </div>
        <div ref={imageAreaRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden" title={t('hint')}
          onPointerDown={event => { if (event.button === 0) { event.preventDefault(); dragWindow() } }}
          onDoubleClick={() => resize(1)} onContextMenu={event => event.preventDefault()} style={{ cursor: busy ? 'wait' : 'grab' }}>
          {context && <img src={convertFileSrc(context.imagePath)} alt={t('imageAlt')} draggable={false} className="pointer-events-none shrink-0 object-contain"
            style={{ width: context.imageWidth / sourceScale * zoom, height: context.imageHeight / sourceScale * zoom, maxWidth: '100%', maxHeight: '100%' }}
            onLoad={() => { setLoaded(true); updateZoom(); void showWindow() }}
            onError={() => { setError(t('loadError')); void showWindow() }} />}
          {!loaded && !error && <div className="absolute inset-0 flex items-center justify-center"><Spinner aria-label={t('loading')} /></div>}
          {error && <div className="pointer-events-none absolute inset-x-2 bottom-2 max-h-full overflow-auto"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>}
          <span role="status" className="sr-only">{recordState === 'saved' ? t('recordSaved') : recordState === 'pending' ? t('savingRecord') : copied ? t('copied') : ''}</span>
        </div>
      </main>
    </ThemeProvider>
  )
}
