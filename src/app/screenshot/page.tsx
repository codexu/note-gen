'use client'

import { useCallback, useEffect, useRef, useState, type ComponentProps, type PointerEvent as ReactPointerEvent } from 'react'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { Image as TauriImage } from '@tauri-apps/api/image'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { writeImage } from '@tauri-apps/plugin-clipboard-manager'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { ArrowUpRight, Check, Circle, Copy, Download, MousePointer2, Pencil, Pin, Redo2, ScanLine, Square, Type, Undo2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ThemeProvider } from '@/components/theme-provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { bytesToBase64, clampPoint, drawAnnotations, drawScreenshot, exportScreenshot, rectFromPoints, type Annotation, type Point, type Rect, type Tool } from '@/lib/screenshot-editor'

interface ScreenshotContext {
  sessionId: string
  monitorId: string
  imagePath: string
  imageWidth: number
  imageHeight: number
  scaleFactor: number
  platform: 'macos' | 'windows' | 'linux'
}

interface EditorState {
  selection: Rect | null
  annotations: Annotation[]
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type Interaction = {
  pointerId: number
  start: Point
  before: EditorState
} & (
  | { kind: 'select' }
  | { kind: 'move'; rect: Rect }
  | { kind: 'resize'; rect: Rect; handle: Handle }
  | { kind: 'draw'; annotation: Annotation }
)

const EMPTY_EDITOR: EditorState = { selection: null, annotations: [] }
const TOOLS = [
  { tool: 'select', icon: MousePointer2, shortcut: 'V' },
  { tool: 'rectangle', icon: Square, shortcut: 'R' },
  { tool: 'ellipse', icon: Circle, shortcut: 'O' },
  { tool: 'arrow', icon: ArrowUpRight, shortcut: 'A' },
  { tool: 'pen', icon: Pencil, shortcut: 'P' },
  { tool: 'text', icon: Type, shortcut: 'T' },
  { tool: 'mosaic', icon: ScanLine, shortcut: 'M' },
] as const
const COLORS = [
  { name: 'red', value: '#ef4444' },
  { name: 'orange', value: '#f97316' },
  { name: 'yellow', value: '#facc15' },
  { name: 'green', value: '#22c55e' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'purple', value: '#a855f7' },
  { name: 'white', value: '#ffffff' },
  { name: 'black', value: '#171717' },
] as const
const HANDLES: { handle: Handle; x: number; y: number; cursor: string }[] = [
  { handle: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { handle: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { handle: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { handle: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { handle: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { handle: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { handle: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { handle: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
]

function within(point: Point, rect: Rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

function constrainToSelection(point: Point, rect: Rect): Point {
  return {
    x: Math.max(rect.x, Math.min(rect.x + rect.width, point.x)),
    y: Math.max(rect.y, Math.min(rect.y + rect.height, point.y)),
  }
}

function resizeSelection(rect: Rect, handle: Handle, delta: Point, viewport: Point): Rect {
  let left = rect.x
  let right = rect.x + rect.width
  let top = rect.y
  let bottom = rect.y + rect.height
  if (handle.includes('w')) left = Math.max(0, Math.min(right - 2, left + delta.x))
  if (handle.includes('e')) right = Math.min(viewport.x, Math.max(left + 2, right + delta.x))
  if (handle.includes('n')) top = Math.max(0, Math.min(bottom - 2, top + delta.y))
  if (handle.includes('s')) bottom = Math.min(viewport.y, Math.max(top + 2, bottom + delta.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function ActionButton({ label, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={label} {...props}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export default function ScreenshotPage() {
  const t = useTranslations('screenshotEditor')
  const [context, setContext] = useState<ScreenshotContext | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#ef4444')
  const [lineWidth, setLineWidth] = useState(3)
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [textDraft, setTextDraft] = useState<{ point: Point; text: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [, refreshHistory] = useState(0)
  const [toolbarSize, setToolbarSize] = useState({ width: 0, height: 0 })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const surfaceRef = useRef<HTMLElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const editorRef = useRef(editor)
  const textDraftRef = useRef(textDraft)
  const interactionRef = useRef<Interaction | null>(null)
  const busyRef = useRef(false)
  const readySessionRef = useRef<string | null>(null)
  const historyRef = useRef<{ past: EditorState[]; future: EditorState[] }>({ past: [], future: [] })

  const updateEditor = useCallback((next: EditorState) => {
    editorRef.current = next
    setEditor(next)
  }, [])

  const commit = useCallback((next: EditorState, before = editorRef.current) => {
    if (next === before) return
    const history = historyRef.current
    history.past = [...history.past.slice(-99), before]
    history.future = []
    updateEditor(next)
    refreshHistory(value => value + 1)
  }, [updateEditor])

  const updateTextDraft = useCallback((next: typeof textDraft) => {
    textDraftRef.current = next
    setTextDraft(next)
  }, [])

  const commitText = useCallback(() => {
    const pending = textDraftRef.current
    if (!pending) return editorRef.current
    updateTextDraft(null)
    if (!pending.text.trim()) return editorRef.current
    const next = {
      ...editorRef.current,
      annotations: [...editorRef.current.annotations, {
        id: crypto.randomUUID(), tool: 'text' as const, points: [pending.point], color, width: lineWidth, text: pending.text,
      }],
    }
    commit(next)
    return next
  }, [color, commit, lineWidth, updateTextDraft])

  const cancel = useCallback(async () => {
    if (busyRef.current) return
    try {
      const sessionId = context?.sessionId || new URLSearchParams(window.location.search).get('sessionId')
      if (sessionId) await invoke('cancel_desktop_screenshot', { sessionId })
      else await getCurrentWindow().close()
    } catch (cause) {
      console.error('Unable to cancel screenshot:', cause)
      setError(t('actionError'))
    }
  }, [context, t])

  const performAction = useCallback(async (action: 'copy' | 'file' | 'record' | 'pin') => {
    if (busyRef.current || interactionRef.current || !imageRef.current || !context || !ready) return
    const current = commitText()
    if (!current.selection || current.selection.width < 2 || current.selection.height < 2) return
    busyRef.current = true
    setBusy(true)
    setError('')
    let completed = false
    try {
      const png = await exportScreenshot(imageRef.current, viewport, current.selection, current.annotations)
      if (action === 'pin') {
        await invoke('pin_screenshot', { sessionId: context.sessionId, pngBase64: bytesToBase64(png) })
        completed = true
      } else if (action === 'record') {
        await invoke('complete_desktop_screenshot', { sessionId: context.sessionId, pngBase64: bytesToBase64(png) })
        completed = true
      } else if (action === 'copy') {
        const image = await TauriImage.fromBytes(png)
        try { await writeImage(image) } finally { await image.close() }
        await invoke('cancel_desktop_screenshot', { sessionId: context.sessionId })
        completed = true
      } else {
        const filename = `NoteGen-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
        let path: string | null
        // Native save panels must sit above the capture windows, including macOS shielding windows.
        await invoke('set_desktop_screenshot_dialog_mode', { sessionId: context.sessionId, active: true })
        try {
          path = await save({ defaultPath: filename, filters: [{ name: 'PNG', extensions: ['png'] }] })
        } finally {
          await invoke('set_desktop_screenshot_dialog_mode', { sessionId: context.sessionId, active: false })
        }
        if (path) {
          await writeFile(path, png)
          await invoke('cancel_desktop_screenshot', { sessionId: context.sessionId })
          completed = true
        }
      }
    } catch (cause) {
      console.error('Screenshot action failed:', cause)
      setError(t('actionError'))
    } finally {
      // Successful actions close all screenshot windows; failed/cancelled saves stay editable.
      if (!completed) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }, [commitText, context, ready, t, viewport])

  const undo = useCallback((redo = false) => {
    if (busyRef.current || interactionRef.current || textDraftRef.current) return
    const history = historyRef.current
    const source = redo ? history.future : history.past
    const previous = source.pop()
    if (!previous) return
    const target = redo ? history.past : history.future
    target.push(editorRef.current)
    updateEditor(previous)
    refreshHistory(value => value + 1)
  }, [updateEditor])

  const reportLoadFailure = useCallback(async (cause: unknown) => {
    console.error('Unable to load screenshot:', cause)
    setError(t('loadError'))
    // Release every display, including a native preview covering a failed editor.
    // The main window reports the error without coming to the foreground.
    const sessionId = new URLSearchParams(window.location.search).get('sessionId')
    if (sessionId) {
      try { await invoke('fail_desktop_screenshot', { sessionId }) }
      catch (closeError) { console.error('Unable to release failed screenshot:', closeError) }
    }
  }, [t])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const initialise = async () => {
      document.documentElement.style.fontSize = '100%'
      setViewport({ width: window.innerWidth, height: window.innerHeight })
      const next = await invoke<ScreenshotContext>('get_desktop_screenshot')
      if (disposed) return
      const requestedSession = new URLSearchParams(window.location.search).get('sessionId')
      if (!requestedSession || requestedSession !== next.sessionId) throw new Error('Expired screenshot session')
      setContext(next)
      const image = new window.Image()
      image.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Screenshot image could not be loaded'))
        image.src = convertFileSrc(next.imagePath)
      })
      if (disposed) { image.src = ''; return }
      imageRef.current = image
      // The native window may have received its final monitor size while loading.
      setViewport({ width: window.innerWidth, height: window.innerHeight })
      setReady(true)
      unlisten = await getCurrentWindow().onCloseRequested(event => {
        event.preventDefault()
        if (!busyRef.current) void invoke('cancel_desktop_screenshot', { sessionId: next.sessionId }).catch(cause => {
          console.error('Unable to cancel screenshot:', cause)
          setError(t('actionError'))
        })
      })
      if (disposed) unlisten()
    }
    void initialise().catch(cause => { if (!disposed) void reportLoadFailure(cause) })
    return () => {
      disposed = true
      unlisten?.()
      imageRef.current = null
    }
  }, [reportLoadFailure])

  useEffect(() => {
    const onResize = () => {
      const next = { width: window.innerWidth, height: window.innerHeight }
      if (!viewport.width || !viewport.height || next.width === viewport.width && next.height === viewport.height) return
      const x = next.width / viewport.width
      const y = next.height / viewport.height
      const remap = (state: EditorState): EditorState => ({
        selection: state.selection ? { x: state.selection.x * x, y: state.selection.y * y, width: state.selection.width * x, height: state.selection.height * y } : null,
        annotations: state.annotations.map(annotation => ({
          ...annotation, width: annotation.width * Math.min(x, y), points: annotation.points.map(point => ({ x: point.x * x, y: point.y * y })),
        })),
      })
      interactionRef.current = null
      setDraft(null)
      setDragging(false)
      updateEditor(remap(editorRef.current))
      historyRef.current.past = historyRef.current.past.map(remap)
      historyRef.current.future = historyRef.current.future.map(remap)
      if (textDraftRef.current) {
        const pending = textDraftRef.current
        updateTextDraft({ ...pending, point: { x: pending.point.x * x, y: pending.point.y * y } })
      }
      setViewport(next)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [updateEditor, updateTextDraft, viewport])

  useEffect(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image || !ready || !viewport.width || !viewport.height) return
    const ratio = window.devicePixelRatio || 1
    const width = Math.round(viewport.width * ratio)
    const height = Math.round(viewport.height * ratio)
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawScreenshot(ctx, image, viewport, [])
    if (editor.selection) {
      const selection = editor.selection
      ctx.save()
      ctx.beginPath()
      ctx.rect(selection.x, selection.y, selection.width, selection.height)
      ctx.clip()
      const annotations = [...editor.annotations]
      if (draft) annotations.push(draft)
      if (textDraft?.text) annotations.push({
        id: 'text-preview', tool: 'text', points: [textDraft.point], color, width: lineWidth, text: textDraft.text,
      })
      drawAnnotations(ctx, annotations)
      ctx.restore()
      ctx.fillStyle = 'rgba(0, 0, 0, 0.46)'
      ctx.fillRect(0, 0, viewport.width, selection.y)
      ctx.fillRect(0, selection.y + selection.height, viewport.width, viewport.height - selection.y - selection.height)
      ctx.fillRect(0, selection.y, selection.x, selection.height)
      ctx.fillRect(selection.x + selection.width, selection.y, viewport.width - selection.x - selection.width, selection.height)
    } else {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
      ctx.fillRect(0, 0, viewport.width, viewport.height)
    }
  }, [color, draft, editor, lineWidth, ready, textDraft, viewport])

  useEffect(() => {
    if (!ready) return
    const focusSurface = () => {
      if (!document.activeElement || document.activeElement === document.body) {
        surfaceRef.current?.focus({ preventScroll: true })
      }
    }
    // Escape must work immediately, before the user clicks the screenshot.
    focusSurface()
    window.addEventListener('focus', focusSurface)
    return () => window.removeEventListener('focus', focusSurface)
  }, [ready])

  // This effect follows the drawing effect, so no display is revealed with a blank canvas.
  useEffect(() => {
    if (!ready || !context || !imageRef.current || readySessionRef.current === context.sessionId) return
    let disposed = false
    readySessionRef.current = context.sessionId
    // Hidden webviews may suspend animation frames; the preceding effect has drawn synchronously.
    void invoke('ready_desktop_screenshot', { sessionId: context.sessionId }).catch(cause => {
      if (!disposed) void reportLoadFailure(cause)
    })
    return () => { disposed = true }
  }, [context, ready, reportLoadFailure])

  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const measure = () => setToolbarSize({ width: toolbar.offsetWidth, height: toolbar.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [Boolean(editor.selection), dragging, tool])

  useEffect(() => {
    if (textDraft) {
      textRef.current?.focus()
    }
  }, [Boolean(textDraft)])

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || busyRef.current) return
      // Handle cancellation before tooltips and focused controls consume Escape.
      event.preventDefault()
      event.stopPropagation()
      void cancel()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || busyRef.current) return
      const target = event.target as HTMLElement | null
      const editable = target?.matches('input, textarea, [contenteditable="true"]')
      if (editable) return
      const command = event.metaKey || event.ctrlKey
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo(event.shiftKey)
      } else if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        undo(true)
      } else if (command && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        void performAction('copy')
      } else if (command && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void performAction('file')
      } else if (event.key === 'Enter') {
        event.preventDefault()
        void performAction('record')
      } else if (!command && !event.altKey) {
        const option = TOOLS.find(item => item.shortcut.toLowerCase() === event.key.toLowerCase())
        if (option && editorRef.current.selection) {
          event.preventDefault()
          commitText()
          setTool(option.tool)
        }
      }
    }
    window.addEventListener('keydown', onEscape, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [cancel, commitText, performAction, undo])

  const pointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || busyRef.current || !ready || interactionRef.current) return
    const target = event.target as HTMLElement
    if (target.closest('[data-screenshot-controls]')) return
    const current = commitText()
    const point = clampPoint({ x: event.clientX, y: event.clientY }, viewport)
    const selection = current.selection
    const handle = target.closest<HTMLElement>('[data-selection-handle]')?.dataset.selectionHandle as Handle | undefined
    const base = { pointerId: event.pointerId, start: point, before: current }
    if (selection && handle) {
      interactionRef.current = { ...base, kind: 'resize', rect: selection, handle }
    } else if (!selection || tool === 'select' && !within(point, selection)) {
      interactionRef.current = { ...base, kind: 'select' }
      updateEditor({ selection: { ...point, width: 0, height: 0 }, annotations: [] })
    } else if (!within(point, selection)) {
      return
    } else if (tool === 'select') {
      interactionRef.current = { ...base, kind: 'move', rect: selection }
    } else if (tool === 'text') {
      updateTextDraft({ point, text: '' })
      return
    } else {
      const annotation: Annotation = { id: crypto.randomUUID(), tool, points: [point], color, width: lineWidth }
      interactionRef.current = { ...base, kind: 'draw', annotation }
      setDraft(annotation)
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    const point = clampPoint({ x: event.clientX, y: event.clientY }, viewport)
    const delta = { x: point.x - interaction.start.x, y: point.y - interaction.start.y }
    if (interaction.kind === 'select') {
      updateEditor({ selection: rectFromPoints(interaction.start, point), annotations: [] })
    } else if (interaction.kind === 'move') {
      const rect = interaction.rect
      updateEditor({ ...interaction.before, selection: {
        ...rect,
        x: Math.max(0, Math.min(viewport.width - rect.width, rect.x + delta.x)),
        y: Math.max(0, Math.min(viewport.height - rect.height, rect.y + delta.y)),
      } })
    } else if (interaction.kind === 'resize') {
      updateEditor({ ...interaction.before, selection: resizeSelection(interaction.rect, interaction.handle, delta, { x: viewport.width, y: viewport.height }) })
    } else if (interaction.before.selection) {
      const end = constrainToSelection(point, interaction.before.selection)
      const previous = interaction.annotation
      const last = previous.points[previous.points.length - 1]
      if (previous.tool === 'pen' && Math.hypot(end.x - last.x, end.y - last.y) < 0.7) return
      const annotation = {
        ...previous,
        points: previous.tool === 'pen' ? [...previous.points, end] : [previous.points[0], end],
      }
      interaction.annotation = annotation
      setDraft(annotation)
    }
  }

  const pointerUp = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    if (!cancelled) pointerMove(event)
    interactionRef.current = null
    setDragging(false)
    setDraft(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (cancelled) {
      updateEditor(interaction.before)
      return
    }
    let next = editorRef.current
    if (interaction.kind === 'draw') {
      const annotation = interaction.annotation
      const first = annotation.points[0]
      const last = annotation.points[annotation.points.length - 1]
      if (annotation.tool !== 'pen' && Math.hypot(last.x - first.x, last.y - first.y) < 2) return
      if (['rectangle', 'ellipse', 'mosaic'].includes(annotation.tool) && (Math.abs(last.x - first.x) < 1 || Math.abs(last.y - first.y) < 1)) return
      next = { ...interaction.before, annotations: [...interaction.before.annotations, annotation] }
    } else if (!next.selection || next.selection.width < 2 || next.selection.height < 2) {
      updateEditor(interaction.before)
      return
    } else if (next.selection.x === interaction.before.selection?.x && next.selection.y === interaction.before.selection?.y
      && next.selection.width === interaction.before.selection?.width && next.selection.height === interaction.before.selection?.height
      && next.annotations === interaction.before.annotations) {
      return
    }
    commit(next, interaction.before)
  }

  const selection = editor.selection
  const toolbarWidth = toolbarSize.width || Math.min(660, viewport.width - 16)
  const toolbarHeight = toolbarSize.height || 112
  const toolbarLeft = selection ? Math.max(8, Math.min(viewport.width - toolbarWidth - 8, selection.x + selection.width - toolbarWidth)) : 8
  const toolbarTop = selection ? Math.max(8, Math.min(viewport.height - toolbarHeight - 8,
    selection.y + selection.height + toolbarHeight + 18 <= viewport.height ? selection.y + selection.height + 10
      : selection.y >= toolbarHeight + 18 ? selection.y - toolbarHeight - 10
        : selection.y + selection.height - toolbarHeight - 10)) : 8
  const pixels = selection && context ? {
    width: Math.round((selection.x + selection.width) * context.imageWidth / viewport.width) - Math.round(selection.x * context.imageWidth / viewport.width),
    height: Math.round((selection.y + selection.height) * context.imageHeight / viewport.height) - Math.round(selection.y * context.imageHeight / viewport.height),
  } : null
  const canUndo = historyRef.current.past.length > 0
  const canRedo = historyRef.current.future.length > 0

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <main ref={surfaceRef} tabIndex={-1} className="fixed inset-0 isolate touch-none overflow-hidden bg-background text-foreground outline-none select-none"
        aria-label={t('title')} aria-busy={busy} style={{ cursor: busy ? 'wait' : tool === 'select' && selection ? 'move' : 'crosshair' }}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerUp(event)} onPointerCancel={event => pointerUp(event, true)}
        onLostPointerCapture={event => pointerUp(event, true)}
        onContextMenu={event => { event.preventDefault(); void cancel() }}
        onDoubleClick={event => {
          if (busy || dragging || !ready || selection && tool !== 'select' || (event.target as HTMLElement).closest('[data-screenshot-controls], [data-selection-handle]')) return
          if (!selection) commit({ selection: { x: 0, y: 0, ...viewport }, annotations: [] })
          else if (within({ x: event.clientX, y: event.clientY }, selection)) void performAction('record')
        }}>
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" />

        {selection && <div className="pointer-events-none absolute border border-primary" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}>
          {!dragging && !busy && HANDLES.map(item => (
            <div key={item.handle} data-selection-handle={item.handle} aria-hidden="true"
              className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 border border-primary bg-background"
              style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, cursor: item.cursor }} />
          ))}
          {pixels && <Badge variant="secondary" className="absolute left-0" style={{ top: selection.y >= 28 ? -27 : 4 }}>{t('pixelSize', pixels)}</Badge>}
        </div>}

        {!selection && <div data-screenshot-controls className="pointer-events-none absolute inset-x-4 top-4 flex items-center justify-end" style={{ cursor: 'default' }}>
          <ActionButton label={t('cancel')} variant="secondary" className="pointer-events-auto" onClick={() => void cancel()}><X data-icon="inline-start" /></ActionButton>
        </div>}

        {error && <div data-screenshot-controls className="absolute inset-x-4 top-16 mx-auto max-w-lg" style={{ cursor: 'default' }}>
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        </div>}

        {selection && !dragging && <div ref={toolbarRef} data-screenshot-controls role="region" aria-label={t('title')}
          className="absolute flex max-h-[calc(100dvh-16px)] flex-col gap-2 overflow-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
          style={{ left: toolbarLeft, top: toolbarTop, width: Math.min(660, Math.max(0, viewport.width - 16)), cursor: 'default' }}>
          <div className="flex flex-wrap items-center gap-1">
            <ToggleGroup type="single" value={tool} spacing={0} disabled={busy}
              aria-label={t('title')} onValueChange={value => { if (value) { commitText(); setTool(value as Tool) } }}>
              {TOOLS.map(({ tool: value, icon: Icon, shortcut }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem value={value} aria-label={`${t(value)} (${shortcut})`}><Icon data-icon="inline-start" /></ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>{t(value)} ({shortcut})</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
            <Separator orientation="vertical" className="h-6" />
            <ActionButton label={t('undo')} disabled={busy || !canUndo || Boolean(textDraft)} onClick={() => undo()}><Undo2 data-icon="inline-start" /></ActionButton>
            <ActionButton label={t('redo')} disabled={busy || !canRedo || Boolean(textDraft)} onClick={() => undo(true)}><Redo2 data-icon="inline-start" /></ActionButton>
            <div className="ml-auto flex items-center gap-1">
              <ActionButton label={t('cancel')} disabled={busy} onClick={() => void cancel()}><X data-icon="inline-start" /></ActionButton>
              <ActionButton label={t('copy')} disabled={busy} onClick={() => void performAction('copy')}><Copy data-icon="inline-start" /></ActionButton>
              <ActionButton label={t('pin')} disabled={busy} onClick={() => void performAction('pin')}><Pin data-icon="inline-start" /></ActionButton>
              <ActionButton label={t('saveFile')} disabled={busy} onClick={() => void performAction('file')}><Download data-icon="inline-start" /></ActionButton>
              <Button type="button" disabled={busy} onClick={() => void performAction('record')}>
                {busy ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                {busy ? t('saving') : t('saveRecord')}
              </Button>
            </div>
          </div>
          {tool !== 'select' && tool !== 'mosaic' && <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" value={color} spacing={0} size="sm" disabled={busy} aria-label={t('color')} onValueChange={value => { if (value) setColor(value) }}>
              {COLORS.map(item => (
                <ToggleGroupItem key={item.value} value={item.value} aria-label={t(item.name)} title={t(item.name)}>
                  <span className="size-4 rounded-full border border-border" style={{ backgroundColor: item.value }} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Field orientation="horizontal" className="ml-auto w-32">
              <FieldLabel htmlFor="screenshot-width" className="sr-only">{t(tool === 'text' ? 'textSize' : 'lineWidth')}</FieldLabel>
              <Slider id="screenshot-width" min={1} max={12} step={1} value={[lineWidth]} disabled={busy} aria-label={t(tool === 'text' ? 'textSize' : 'lineWidth')}
                onValueChange={value => setLineWidth(value[0])} />
              <span className="w-7 shrink-0 text-center text-xs tabular-nums">{tool === 'text' ? Math.max(14, lineWidth * 6) : lineWidth}</span>
            </Field>
          </div>}
          {tool === 'mosaic' && <Field orientation="horizontal" className="w-44">
            <FieldLabel htmlFor="screenshot-mosaic-width" className="sr-only">{t('lineWidth')}</FieldLabel>
            <Slider id="screenshot-mosaic-width" min={1} max={12} step={1} value={[lineWidth]} disabled={busy} aria-label={t('lineWidth')}
              onValueChange={value => setLineWidth(value[0])} />
            <span className="w-7 shrink-0 text-center text-xs tabular-nums">{Math.max(10, lineWidth * 6)}</span>
          </Field>}
        </div>}

        {textDraft && <div data-screenshot-controls className="absolute flex flex-col gap-2 rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"
          style={{
            left: Math.max(8, Math.min(viewport.width - 296, textDraft.point.x)),
            top: Math.max(8, Math.min(viewport.height - 190, textDraft.point.y)),
            width: Math.min(288, viewport.width - 16), cursor: 'default',
          }}>
          <Field>
            <FieldLabel htmlFor="screenshot-text" className="sr-only">{t('text')}</FieldLabel>
            <Textarea id="screenshot-text" ref={textRef} value={textDraft.text} placeholder={t('textPlaceholder')} disabled={busy} maxLength={4000} wrap="off"
              className="max-h-48 resize-none" style={{ fontSize: Math.max(14, lineWidth * 6), lineHeight: 1.35 }}
              onChange={event => updateTextDraft({ ...textDraft, text: event.target.value })}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); commitText() }
              }} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => updateTextDraft(null)}>{t('discardText')}</Button>
            <Button type="button" size="sm" onClick={() => commitText()}>{t('addText')}</Button>
          </div>
        </div>}
      </main>
    </ThemeProvider>
  )
}
