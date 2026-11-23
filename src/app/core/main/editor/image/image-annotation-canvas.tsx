'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { clampPoint, drawAnnotations, drawScreenshot, type Annotation, type Tool } from '@/lib/screenshot-editor'

export type RecordAnnotationTool = Extract<Tool, 'pen' | 'arrow' | 'mosaic'>

interface ImageAnnotationCanvasProps {
  src: string
  width: number
  height: number
  displayWidth: number
  displayHeight: number
  tool: RecordAnnotationTool | null
  annotations: readonly Annotation[]
  onAnnotation: (annotation: Annotation) => void
  onDrawingChange?: (drawing: boolean) => void
  disabled?: boolean
  label?: string
}

interface Gesture {
  pointerId: number
  annotation: Annotation
  pixelsPerDisplayPixel: number
}

const MAX_PREVIEW_EDGE = 2048
const MAX_PREVIEW_PIXELS = 2_000_000
const DEFAULT_STROKE_WIDTH = 3

function hasVisibleAnnotation({ annotation, pixelsPerDisplayPixel }: Gesture) {
  if (annotation.tool === 'pen') return true
  const [start, end] = annotation.points
  if (!end) return false

  const dx = Math.abs(end.x - start.x)
  const dy = Math.abs(end.y - start.y)
  return annotation.tool === 'arrow'
    ? Math.hypot(dx, dy) >= 2 * pixelsPerDisplayPixel
    : Math.min(dx, dy) >= pixelsPerDisplayPixel
}

export function ImageAnnotationCanvas({
  src,
  width,
  height,
  displayWidth,
  displayHeight,
  tool,
  annotations,
  onAnnotation,
  onDrawingChange,
  disabled = false,
  label,
}: ImageAnnotationCanvasProps) {
  const [image, setImage] = useState<{ src: string; element: HTMLImageElement } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<{ canvas: HTMLCanvasElement; scaleX: number; scaleY: number } | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const frameRef = useRef<number | null>(null)
  const onDrawingChangeRef = useRef(onDrawingChange)
  const canDraw = tool !== null && !disabled && image?.src === src

  useLayoutEffect(() => {
    onDrawingChangeRef.current = onDrawingChange
  }, [onDrawingChange])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    const base = baseRef.current
    if (!base) return

    context.drawImage(base.canvas, 0, 0)
    const gesture = gestureRef.current
    if (gesture && hasVisibleAnnotation(gesture)) {
      context.setTransform(base.scaleX, 0, 0, base.scaleY, 0, 0)
      drawAnnotations(context, [gesture.annotation])
    }
  }, [])

  const schedulePaint = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      paint()
    })
  }, [paint])

  const cancelGesture = useCallback(() => {
    const gesture = gestureRef.current
    if (!gesture) return

    gestureRef.current = null
    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture(gesture.pointerId)) canvas.releasePointerCapture(gesture.pointerId)
    onDrawingChangeRef.current?.(false)
    schedulePaint()
  }, [schedulePaint])

  useEffect(() => {
    const element = new Image()
    element.decoding = 'async'
    element.onload = () => setImage({ src, element })
    element.src = src
    return () => { element.onload = null }
  }, [src])

  useLayoutEffect(() => {
    cancelGesture()
  }, [src, width, height, displayWidth, displayHeight, tool, disabled, cancelGesture])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const validSize = [width, height, displayWidth, displayHeight].every(value => Number.isFinite(value) && value > 0)
    if (!validSize) {
      if (baseRef.current) baseRef.current.canvas.width = 0
      baseRef.current = null
      paint()
      return
    }
    if (image?.src !== src) return

    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2,
      MAX_PREVIEW_EDGE / Math.max(displayWidth, displayHeight),
      Math.sqrt(MAX_PREVIEW_PIXELS / (displayWidth * displayHeight)),
    )
    const bufferWidth = Math.max(1, Math.floor(displayWidth * ratio))
    const bufferHeight = Math.max(1, Math.floor(displayHeight * ratio))
    const base = baseRef.current?.canvas ?? document.createElement('canvas')
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight
    if (base.width !== bufferWidth) base.width = bufferWidth
    if (base.height !== bufferHeight) base.height = bufferHeight

    // Cache the committed frame so moves only redraw the current stroke.
    const context = base.getContext('2d')
    if (!context) return
    const scaleX = bufferWidth / width
    const scaleY = bufferHeight / height
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0)
    drawScreenshot(context, image.element, { width, height }, annotations)
    baseRef.current = { canvas: base, scaleX, scaleY }
    paint()
  }, [src, image, width, height, displayWidth, displayHeight, annotations, paint])

  useLayoutEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    if (baseRef.current) baseRef.current.canvas.width = 0
    const wasDrawing = gestureRef.current !== null
    frameRef.current = null
    baseRef.current = null
    gestureRef.current = null
    if (wasDrawing) onDrawingChangeRef.current?.(false)
  }, [])

  function getPointerPoint(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return null

    const scaleX = width / bounds.width
    const scaleY = height / bounds.height
    return {
      point: clampPoint({ x: (event.clientX - bounds.left) * scaleX, y: (event.clientY - bounds.top) * scaleY }, { width, height }),
      pixelsPerDisplayPixel: Math.min(scaleX, scaleY),
    }
  }

  function startGesture(event: PointerEvent<HTMLCanvasElement>) {
    if (!baseRef.current || !canDraw || !tool || gestureRef.current || !event.isPrimary || event.button !== 0) return

    const position = getPointerPoint(event)
    if (!position) return

    const { point, pixelsPerDisplayPixel } = position
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      tool,
      points: [point],
      color: '#ef4444',
      width: Math.max(1, DEFAULT_STROKE_WIDTH * pixelsPerDisplayPixel),
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = { pointerId: event.pointerId, annotation, pixelsPerDisplayPixel }
    onDrawingChangeRef.current?.(true)
    schedulePaint()
  }

  function extendGesture(event: PointerEvent<HTMLCanvasElement>, gesture: Gesture) {
    const position = getPointerPoint(event)
    if (!position) return

    const { point } = position
    const { annotation, pixelsPerDisplayPixel } = gesture
    const { points } = annotation
    if (annotation.tool === 'pen') {
      const last = points[points.length - 1]
      if (Math.hypot(last.x - point.x, last.y - point.y) < 0.7 * pixelsPerDisplayPixel) return
      points.push(point)
    } else {
      points[1] = point
    }
  }

  function moveGesture(event: PointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return

    extendGesture(event, gesture)
    schedulePaint()
  }

  function finishGesture(event: PointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return

    extendGesture(event, gesture)
    if (hasVisibleAnnotation(gesture)) onAnnotation(gesture.annotation)
    cancelGesture()
  }

  function stopGesture(event: PointerEvent<HTMLCanvasElement>) {
    if (gestureRef.current?.pointerId === event.pointerId) cancelGesture()
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      data-swipe-back-ignore={canDraw ? '' : undefined}
      className={`record-image-surface block shrink-0 select-none ${canDraw ? 'touch-none cursor-crosshair' : 'cursor-default'}`}
      style={{ width: displayWidth, height: displayHeight }}
      onPointerDown={startGesture}
      onPointerMove={moveGesture}
      onPointerUp={finishGesture}
      onPointerCancel={stopGesture}
      onLostPointerCapture={stopGesture}
    />
  )
}
