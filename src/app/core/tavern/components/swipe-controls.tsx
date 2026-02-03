'use client'

import { useState, useRef, useCallback, useEffect, TouchEvent, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Plus, Trash2, RotateCcw } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface SwipeControlsProps {
  /** 消息 ID */
  messageId: number
  /** 当前 swipe 索引 */
  currentIndex: number
  /** swipe 总数 */
  totalCount: number
  /** 切换 swipe 回调 */
  onSwitch: (messageId: number, direction: 'left' | 'right' | number) => void
  /** 生成新 swipe 回调 */
  onGenerate?: (messageId: number) => void
  /** 删除当前 swipe 回调 */
  onDelete?: (messageId: number, swipeId: number) => void
  /** 是否正在生成 */
  isGenerating?: boolean
  /** 是否显示生成按钮 */
  showGenerateButton?: boolean
  /** 是否显示删除按钮 */
  showDeleteButton?: boolean
  /** 是否启用触摸滑动 */
  enableTouchSwipe?: boolean
  /** 是否启用键盘导航 */
  enableKeyboard?: boolean
  /** 自定义类名 */
  className?: string
  /** 紧凑模式 */
  compact?: boolean
}

/**
 * Swipe 控件组件
 * 
 * 支持:
 * - 左右箭头切换
 * - 触摸滑动手势
 * - 键盘导航 (左右方向键)
 * - 生成新 swipe
 * - 删除当前 swipe
 */
export function SwipeControls({
  messageId,
  currentIndex,
  totalCount,
  onSwitch,
  onGenerate,
  onDelete,
  isGenerating = false,
  showGenerateButton = true,
  showDeleteButton = true,
  enableTouchSwipe = true,
  enableKeyboard = false,
  className,
  compact = false,
}: SwipeControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [touchDeltaX, setTouchDeltaX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)

  // 切换到上一个
  const handlePrev = useCallback(() => {
    if (isGenerating) return
    onSwitch(messageId, 'left')
  }, [messageId, onSwitch, isGenerating])

  // 切换到下一个
  const handleNext = useCallback(() => {
    if (isGenerating) return
    onSwitch(messageId, 'right')
  }, [messageId, onSwitch, isGenerating])

  // 生成新 swipe
  const handleGenerate = useCallback(() => {
    if (isGenerating || !onGenerate) return
    onGenerate(messageId)
  }, [messageId, onGenerate, isGenerating])

  // 删除当前 swipe
  const handleDelete = useCallback(() => {
    if (isGenerating || !onDelete || totalCount <= 1) return
    onDelete(messageId, currentIndex)
  }, [messageId, currentIndex, onDelete, isGenerating, totalCount])

  // 触摸事件处理
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enableTouchSwipe || isGenerating) return
    setTouchStartX(e.touches[0].clientX)
    setIsSwiping(true)
  }, [enableTouchSwipe, isGenerating])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (touchStartX === null || !isSwiping) return
    const deltaX = e.touches[0].clientX - touchStartX
    setTouchDeltaX(deltaX)
  }, [touchStartX, isSwiping])

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping || touchStartX === null) return

    // 判断滑动方向和距离
    const threshold = 50 // 最小滑动距离
    if (Math.abs(touchDeltaX) > threshold) {
      if (touchDeltaX > 0) {
        handlePrev()
      } else {
        handleNext()
      }
    }

    // 重置状态
    setTouchStartX(null)
    setTouchDeltaX(0)
    setIsSwiping(false)
  }, [isSwiping, touchStartX, touchDeltaX, handlePrev, handleNext])

  // 键盘事件处理
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enableKeyboard || isGenerating) return

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        handlePrev()
        break
      case 'ArrowRight':
        e.preventDefault()
        handleNext()
        break
    }
  }, [enableKeyboard, isGenerating, handlePrev, handleNext])

  // 焦点管理
  useEffect(() => {
    if (enableKeyboard && containerRef.current) {
      containerRef.current.focus()
    }
  }, [enableKeyboard])

  // 如果只有一个 swipe 且不显示生成按钮，不显示控件
  if (totalCount <= 1 && !showGenerateButton) {
    return null
  }

  const buttonSize = compact ? 'h-6 w-6' : 'h-7 w-7'
  const iconSize = compact ? 'h-3 w-3' : 'h-4 w-4'

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex items-center gap-1',
        className
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
      tabIndex={enableKeyboard ? 0 : -1}
      role="group"
      aria-label={`Swipe controls: ${currentIndex + 1} of ${totalCount}`}
    >
      {/* 上一个 */}
      {totalCount > 1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSize}
              onClick={handlePrev}
              disabled={isGenerating}
              aria-label="Previous swipe"
            >
              <ChevronLeft className={iconSize} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>上一个 (←)</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* 计数显示 */}
      {totalCount > 1 && (
        <span className={cn(
          'min-w-[40px] text-center tabular-nums',
          compact ? 'text-xs' : 'text-sm'
        )}>
          {currentIndex + 1} / {totalCount}
        </span>
      )}

      {/* 下一个 */}
      {totalCount > 1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSize}
              onClick={handleNext}
              disabled={isGenerating}
              aria-label="Next swipe"
            >
              <ChevronRight className={iconSize} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>下一个 (→)</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* 分隔符 */}
      {(showGenerateButton || showDeleteButton) && totalCount > 1 && (
        <div className="w-px h-4 bg-border mx-1" />
      )}

      {/* 生成新 swipe */}
      {showGenerateButton && onGenerate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={buttonSize}
              onClick={handleGenerate}
              disabled={isGenerating}
              aria-label="Generate new swipe"
            >
              {isGenerating ? (
                <RotateCcw className={cn(iconSize, 'animate-spin')} />
              ) : (
                <Plus className={iconSize} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>生成新回复</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* 删除当前 swipe */}
      {showDeleteButton && onDelete && totalCount > 1 && (
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(buttonSize, 'text-destructive hover:text-destructive')}
                  disabled={isGenerating || totalCount <= 1}
                  aria-label="Delete current swipe"
                >
                  <Trash2 className={iconSize} />
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>删除此回复</p>
            </TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除这条回复吗？此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* 滑动指示器 (触摸时显示) */}
      {isSwiping && Math.abs(touchDeltaX) > 10 && (
        <div
          className={cn(
            'absolute inset-0 pointer-events-none flex items-center justify-center',
            'bg-background/50 rounded-lg'
          )}
        >
          {touchDeltaX > 0 ? (
            <ChevronLeft className="h-8 w-8 text-primary animate-pulse" />
          ) : (
            <ChevronRight className="h-8 w-8 text-primary animate-pulse" />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Swipe 手势包装器
 * 包装任意内容，添加触摸滑动支持
 */
export interface SwipeGestureWrapperProps {
  children: React.ReactNode
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  threshold?: number
  disabled?: boolean
  className?: string
}

export function SwipeGestureWrapper({
  children,
  onSwipeLeft,
  onSwipeRight,
  threshold = 50,
  disabled = false,
  className,
}: SwipeGestureWrapperProps) {
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [touchStartY, setTouchStartY] = useState<number | null>(null)

  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (disabled) return
    setTouchStartX(e.touches[0].clientX)
    setTouchStartY(e.touches[0].clientY)
  }, [disabled])

  const handleTouchEnd = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (disabled || touchStartX === null || touchStartY === null) return

    const touchEndX = e.changedTouches[0].clientX
    const touchEndY = e.changedTouches[0].clientY
    const deltaX = touchEndX - touchStartX
    const deltaY = touchEndY - touchStartY

    // 确保是水平滑动而不是垂直滚动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
      if (deltaX > 0 && onSwipeRight) {
        onSwipeRight()
      } else if (deltaX < 0 && onSwipeLeft) {
        onSwipeLeft()
      }
    }

    setTouchStartX(null)
    setTouchStartY(null)
  }, [disabled, touchStartX, touchStartY, threshold, onSwipeLeft, onSwipeRight])

  return (
    <div
      className={className}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </div>
  )
}

/**
 * 使用 Swipe 手势的 Hook
 */
export interface UseSwipeGestureOptions {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
  threshold?: number
  disabled?: boolean
}

export function useSwipeGesture(options: UseSwipeGestureOptions) {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 50,
    disabled = false,
  } = options

  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled) return
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    }
  }, [disabled])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (disabled || !touchStartRef.current) return

    const { x: startX, y: startY } = touchStartRef.current
    const endX = e.changedTouches[0].clientX
    const endY = e.changedTouches[0].clientY
    const deltaX = endX - startX
    const deltaY = endY - startY

    // 判断滑动方向
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      // 水平滑动
      if (Math.abs(deltaX) > threshold) {
        if (deltaX > 0 && onSwipeRight) {
          onSwipeRight()
        } else if (deltaX < 0 && onSwipeLeft) {
          onSwipeLeft()
        }
      }
    } else {
      // 垂直滑动
      if (Math.abs(deltaY) > threshold) {
        if (deltaY > 0 && onSwipeDown) {
          onSwipeDown()
        } else if (deltaY < 0 && onSwipeUp) {
          onSwipeUp()
        }
      }
    }

    touchStartRef.current = null
  }, [disabled, threshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown])

  return {
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
  }
}
