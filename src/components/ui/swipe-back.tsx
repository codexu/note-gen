'use client'

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface SwipeBackHandle {
  back: () => void
}

interface SwipeBackProps {
  children: React.ReactNode
  edgeWidth?: number // 左侧边缘触发区域宽度（像素）
  threshold?: number // 触发返回的滑动距离阈值（像素）
  enabled?: boolean
  onBack?: () => void
  className?: string
  backdrop?: React.ReactNode
}

export const SwipeBack = forwardRef<SwipeBackHandle, SwipeBackProps>(
  function SwipeBack({
    children,
    edgeWidth = 24,
    threshold = 72,
    enabled = true,
    onBack,
    className,
    backdrop,
  }, ref) {
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const x = useMotionValue(0)
  const backdropX = useTransform(x, [0, 240], [-48, 0], { clamp: true })
  const [canGoBack, setCanGoBack] = useState(false)

  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const lastTouchX = useRef(0)
  const lastTouchTime = useRef(0)
  const gestureVelocityX = useRef(0)
  const gestureState = useRef<'idle' | 'pending' | 'dragging' | 'cancelled'>('idle')
  const navigating = useRef(false)
  const exiting = useRef(false)

  // 检查是否可以返回
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCanGoBack(Boolean(onBack) || window.history.length > 1)
    }
  }, [onBack])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const target = e.target
    if (
      target instanceof HTMLElement
      && target.closest(
        '[data-slot="drawer-content"], [data-slot="dialog-content"], [data-swipe-back-ignore], input, textarea, select, [contenteditable]:not([contenteditable="false"]), .ProseMirror, .cm-editor'
      )
    ) {
      return
    }

    if (
      document.querySelector(
        '[data-slot="drawer-content"][data-state="open"], [data-slot="dialog-content"][data-state="open"]'
      )
    ) {
      return
    }

    const touch = e.touches[0]
    const touchX = touch.clientX

    // 只在左侧边缘区域响应
    if (touchX <= edgeWidth && !navigating.current && !exiting.current) {
      touchStartX.current = touch.clientX
      touchStartY.current = touch.clientY
      lastTouchX.current = touch.clientX
      lastTouchTime.current = performance.now()
      gestureVelocityX.current = 0
      gestureState.current = 'pending'
    }
  }, [edgeWidth])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (
      touchStartX.current === null
      || touchStartY.current === null
      || gestureState.current === 'idle'
      || gestureState.current === 'cancelled'
    ) {
      return
    }

    const touch = e.touches[0]
    const deltaX = touch.clientX - touchStartX.current
    const deltaY = touch.clientY - touchStartY.current

    if (gestureState.current === 'pending') {
      if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
        gestureState.current = 'cancelled'
        return
      }

      if (deltaX > 6 && deltaX > Math.abs(deltaY)) {
        gestureState.current = 'dragging'
      }
    }

    if (gestureState.current !== 'dragging') return

    e.preventDefault()
    const now = performance.now()
    const elapsed = Math.max(now - lastTouchTime.current, 1)
    gestureVelocityX.current = ((touch.clientX - lastTouchX.current) / elapsed) * 1000
    x.set(Math.min(window.innerWidth, Math.max(0, deltaX)))
    lastTouchX.current = touch.clientX
    lastTouchTime.current = now
  }, [x])

  const resetGesture = useCallback(() => {
    touchStartX.current = null
    touchStartY.current = null
    gestureState.current = 'idle'
  }, [])

  const navigateBack = useCallback(() => {
    if (navigating.current) return
    navigating.current = true

    if (onBack) {
      onBack()
      return
    }

    router.back()
  }, [onBack, router])

  const finishBack = useCallback(() => {
    if (exiting.current || navigating.current) return
    exiting.current = true
    resetGesture()

    if (reduceMotion) {
      navigateBack()
      return
    }

    animate(x, window.innerWidth, {
      duration: 0.22,
      ease: [0.32, 0.72, 0, 1],
      onComplete: navigateBack,
    })
  }, [navigateBack, reduceMotion, resetGesture, x])

  useImperativeHandle(ref, () => ({
    back: finishBack,
  }), [finishBack])

  const settleGesture = useCallback((e: TouchEvent, cancelled = false) => {
    if (
      touchStartX.current === null
      || touchStartY.current === null
      || gestureState.current !== 'dragging'
    ) {
      resetGesture()
      return
    }

    const touch = e.changedTouches[0]
    if (!touch) {
      resetGesture()
      x.set(0)
      return
    }
    const deltaX = touch.clientX - touchStartX.current
    const deltaY = Math.abs(touch.clientY - touchStartY.current)
    const shouldGoBack = !cancelled
      && deltaX > deltaY
      && (deltaX >= threshold || gestureVelocityX.current >= 650)

    resetGesture()

    if (shouldGoBack) {
      finishBack()
      return
    }

    if (reduceMotion) {
      x.set(0)
      return
    }

    animate(x, 0, {
      type: 'spring',
      stiffness: 520,
      damping: 42,
    })
  }, [finishBack, reduceMotion, resetGesture, threshold, x])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    settleGesture(e)
  }, [settleGesture])

  const handleTouchCancel = useCallback((e: TouchEvent) => {
    settleGesture(e, true)
  }, [settleGesture])

  useEffect(() => {
    if (!enabled || !canGoBack) return

    const container = document.body

    container.addEventListener('touchstart', handleTouchStart, { passive: false })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd, { passive: false })
    container.addEventListener('touchcancel', handleTouchCancel, { passive: false })

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
      container.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [
    canGoBack,
    enabled,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  ])

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-muted/50', className)}>
      {backdrop ? (
        <motion.div
          aria-hidden
          inert
          className="pointer-events-none absolute inset-0"
          style={{ x: backdropX }}
        >
          {backdrop}
        </motion.div>
      ) : null}
      <motion.div
        className="relative h-full w-full bg-background shadow-2xl"
        style={{ x }}
      >
        {children}
      </motion.div>
    </div>
  )
})
