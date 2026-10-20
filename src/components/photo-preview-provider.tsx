'use client'

import type * as React from "react"
import { ImageOff, LoaderCircle, Minus, Plus, RotateCw, X } from "lucide-react"
import { PhotoProvider } from "react-photo-view"
import { Button } from "@/components/ui/button"

type OverlayProps = Parameters<NonNullable<React.ComponentProps<typeof PhotoProvider>["overlayRender"]>>[0]

const MIN_SCALE = 1
const MAX_SCALE = 8
const SCALE_STEP = 0.5

function stopPreviewInteraction(event: React.SyntheticEvent) {
  event.stopPropagation()
}

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(scale.toFixed(2))))
}

function PhotoToolbar({ scale, onScale }: OverlayProps) {
  const nextZoomOut = clampScale(scale - SCALE_STEP)
  const nextZoomIn = clampScale(scale + SCALE_STEP)

  return (
    <div
      className="notegen-photo-preview-control fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/70 p-1.5 text-white shadow-2xl backdrop-blur-md sm:bottom-8"
      onClick={stopPreviewInteraction}
      onMouseDown={stopPreviewInteraction}
      onPointerDown={stopPreviewInteraction}
      onTouchStart={stopPreviewInteraction}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-full text-white hover:bg-white/10 hover:text-white disabled:opacity-40"
        onClick={() => onScale(nextZoomOut)}
        disabled={scale <= MIN_SCALE}
        aria-label="Zoom out"
      >
        <Minus className="h-4 w-4" />
      </Button>
      <span className="min-w-14 text-center text-xs tabular-nums text-white/80">
        {Math.round(scale * 100)}%
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-full text-white hover:bg-white/10 hover:text-white disabled:opacity-40"
        onClick={() => onScale(nextZoomIn)}
        disabled={scale >= MAX_SCALE}
        aria-label="Zoom in"
      >
        <Plus className="h-4 w-4" />
      </Button>
      <div className="mx-1 h-5 w-px bg-white/15" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-full text-white hover:bg-white/10 hover:text-white"
        onClick={() => onScale(1)}
        disabled={scale === 1}
        aria-label="Reset zoom"
      >
        <span className="text-xs font-medium">1x</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-full text-white hover:bg-white/10 hover:text-white"
        onClick={() => onScale(MAX_SCALE)}
        disabled={scale === MAX_SCALE}
        aria-label="Maximum zoom"
      >
        <span className="text-xs font-medium">{MAX_SCALE}x</span>
      </Button>
    </div>
  )
}

function PhotoOverlay(props: OverlayProps) {
  const { images, index, overlayVisible, rotate, onRotate, onClose } = props

  if (!overlayVisible) {
    return null
  }

  return (
    <>
      <div
        className="notegen-photo-preview-control fixed left-4 top-[56px] rounded-full border border-white/15 bg-black/60 px-3 py-1 text-xs font-medium text-white/85 shadow-lg backdrop-blur-md sm:left-6"
        onClick={stopPreviewInteraction}
        onMouseDown={stopPreviewInteraction}
        onPointerDown={stopPreviewInteraction}
        onTouchStart={stopPreviewInteraction}
      >
        {index + 1} / {images.length}
      </div>
      <div
        className="notegen-photo-preview-control fixed right-4 top-[56px] flex items-center gap-1 rounded-full border border-white/15 bg-black/60 p-1 text-white shadow-lg backdrop-blur-md sm:right-6"
        onClick={stopPreviewInteraction}
        onMouseDown={stopPreviewInteraction}
        onPointerDown={stopPreviewInteraction}
        onTouchStart={stopPreviewInteraction}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-white hover:bg-white/10 hover:text-white"
          onClick={() => onRotate(rotate + 90)}
          aria-label="Rotate image"
        >
          <RotateCw className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-white hover:bg-white/10 hover:text-white"
          onClick={(event) => onClose(event)}
          aria-label="Close preview"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <PhotoToolbar {...props} />
    </>
  )
}

export function PhotoPreviewProvider({ children }: { children: React.ReactNode }) {
  return (
    <PhotoProvider
      maskClosable
      pullClosable
      maskOpacity={0.92}
      photoClosable={false}
      className="notegen-photo-preview select-none"
      photoClassName="notegen-photo-preview-photo rounded-lg shadow-2xl"
      loadingElement={
        <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-black/40 text-white">
          <LoaderCircle className="h-7 w-7 animate-spin" />
        </div>
      }
      brokenElement={
        <div className="flex min-h-40 min-w-56 flex-col items-center justify-center gap-3 rounded-lg border border-white/10 bg-black/50 p-6 text-white/75">
          <ImageOff className="h-7 w-7" />
          <span className="text-sm">Image unavailable</span>
        </div>
      }
      overlayRender={(props) => <PhotoOverlay {...props} />}
    >
      {children}
    </PhotoProvider>
  )
}
