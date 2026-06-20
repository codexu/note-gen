'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { X, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MermaidLightboxProps {
  pngUrl: string
  onClose: () => void
}

export function MermaidLightbox({ pngUrl, onClose }: MermaidLightboxProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const scaleRef = useRef(1)
  const translateRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const [copied, setCopied] = useState(false)

  const applyTransform = useCallback(() => {
    if (!imgRef.current) return
    const { x, y } = translateRef.current
    imgRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scaleRef.current})`
  }, [])

  const fitToScreen = useCallback(() => {
    if (!imgRef.current || !containerRef.current) return
    const imgW = imgRef.current.naturalWidth
    const imgH = imgRef.current.naturalHeight
    if (!imgW || !imgH) return
    const padW = containerRef.current.clientWidth - 80
    const padH = containerRef.current.clientHeight - 80
    scaleRef.current = Math.min(padW / imgW, padH / imgH, 1)
    translateRef.current = { x: 0, y: 0 }
    applyTransform()
  }, [applyTransform])

  // Fit on mount after image loads
  const handleImgLoad = useCallback(() => {
    fitToScreen()
  }, [fitToScreen])

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Wheel zoom centered on cursor
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left - rect.width / 2
      const mouseY = e.clientY - rect.top - rect.height / 2
      // 用 deltaY 实际值计算，单步最多缩放 ±15%，避免 trackpad 飞速缩放
      const factor = -e.deltaY * 0.003
      const clamped = Math.max(-0.2, Math.min(0.2, factor))
      const newScale = Math.min(10, Math.max(0.1, scaleRef.current * (1 + clamped)))
      const ratio = newScale / scaleRef.current
      translateRef.current = {
        x: mouseX + (translateRef.current.x - mouseX) * ratio,
        y: mouseY + (translateRef.current.y - mouseY) * ratio,
      }
      scaleRef.current = newScale
      applyTransform()
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [applyTransform])

  // Drag to pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDraggingRef.current = true
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    e.preventDefault()
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return
    translateRef.current = {
      x: translateRef.current.x + (e.clientX - lastPosRef.current.x),
      y: translateRef.current.y + (e.clientY - lastPosRef.current.y),
    }
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    applyTransform()
  }, [applyTransform])

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  // Copy PNG to clipboard
  const handleCopy = useCallback(async () => {
    try {
      const res = await fetch(pngUrl)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }, [pngUrl])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Controls */}
      <div
        className="absolute top-4 right-4 flex items-center gap-2 z-10"
        onClick={e => e.stopPropagation()}
      >
        <Button variant="secondary" size="icon" onClick={handleCopy} title="复制为 PNG">
          {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
        </Button>
        <Button variant="secondary" size="icon" onClick={onClose} title="关闭">
          <X className="size-4" />
        </Button>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className="w-full h-full flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
        onClick={e => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={fitToScreen}
      >
        <img
          ref={imgRef}
          src={pngUrl}
          alt="mermaid diagram"
          onLoad={handleImgLoad}
          draggable={false}
          className="rounded shadow-lg"
          style={{ willChange: 'transform', transformOrigin: 'center center' }}
        />
      </div>

      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/40 pointer-events-none select-none">
        滚轮缩放 · 拖拽平移 · 双击适配
      </p>
    </div>
  )
}
