'use client'
import Image from "next/image"
import React, { useEffect, useRef, useState } from "react";
import { convertImage } from '@/lib/utils'
import { getCachedRecordImageThumbnailPath, getRecordImageThumbnailPath } from "@/lib/record-image-thumbnail";
import emitter from '@/lib/emitter'

const BLANK_IMAGE_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
const RESOLVED_IMAGE_SRC_RE = /^(?:https?:|data:|blob:|asset:|tauri:|file:)/i

type LocalImageProps = React.ComponentProps<typeof Image> & {
  onResolvedSrc?: (src: string) => void
  useThumbnail?: boolean
  thumbnailMaxSize?: number
  generateThumbnail?: boolean
}

function getImageSrcString(src: LocalImageProps['src']) {
  if (typeof src === 'string') {
    return src
  }

  return 'src' in src ? src.src : src.default.src
}

export function LocalImage({
  onLoad,
  onResolvedSrc,
  useThumbnail = false,
  thumbnailMaxSize,
  generateThumbnail = true,
  src,
  alt = '',
  width = 0,
  height = 0,
  loading,
  decoding,
  ...props
}: LocalImageProps) {
  const [localSrc, setLocalSrc] = useState<string>('')
  const [shouldResolve, setShouldResolve] = useState(loading === 'eager')
  const [resolveVersion, setResolveVersion] = useState(0)
  const imageRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const sourcePath = getImageSrcString(src).trim().replace(/^\/+/, '')
    const handleAssetsDownloaded = ({ paths }: { paths: string[] }) => {
      if (!paths.includes(sourcePath)) {
        return
      }

      setLocalSrc('')
      setResolveVersion(version => version + 1)
    }

    emitter.on('record-assets-downloaded', handleAssetsDownloaded)
    return () => {
      emitter.off('record-assets-downloaded', handleAssetsDownloaded)
    }
  }, [src])

  useEffect(() => {
    if (loading === 'eager') {
      setShouldResolve(true)
    }
  }, [loading])

  useEffect(() => {
    if (!onResolvedSrc) {
      return
    }

    let cancelled = false

    async function resolveOriginalSrc() {
      const sourcePath = getImageSrcString(src)
      const originalSrc = await convertImage(sourcePath)

      if (!cancelled) {
        onResolvedSrc?.(originalSrc)
      }
    }

    void resolveOriginalSrc()

    return () => {
      cancelled = true
    }
  }, [onResolvedSrc, src])

  useEffect(() => {
    if (shouldResolve) {
      return
    }

    const imageElement = imageRef.current
    if (!imageElement || typeof IntersectionObserver === 'undefined') {
      setShouldResolve(true)
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldResolve(true)
        observer.disconnect()
      }
    }, {
      rootMargin: useThumbnail ? '120px' : '320px',
    })

    observer.observe(imageElement)

    return () => {
      observer.disconnect()
    }
  }, [shouldResolve, useThumbnail])

  useEffect(() => {
    if (!shouldResolve) {
      return
    }

    let cancelled = false

    async function resolveSrc() {
      const sourcePath = getImageSrcString(src)
      const originalSrc = await convertImage(sourcePath)
      const thumbnailPath = useThumbnail
        ? generateThumbnail
          ? await getRecordImageThumbnailPath(sourcePath, thumbnailMaxSize)
          : await getCachedRecordImageThumbnailPath(sourcePath, thumbnailMaxSize)
        : null
      const nextSrc = thumbnailPath
        ? await convertImage(thumbnailPath)
        : useThumbnail && !generateThumbnail && !RESOLVED_IMAGE_SRC_RE.test(sourcePath)
          ? BLANK_IMAGE_SRC
          : originalSrc

      if (cancelled) {
        return
      }

      setLocalSrc(nextSrc)
    }

    void resolveSrc()

    return () => {
      cancelled = true
    }
  }, [generateThumbnail, onResolvedSrc, resolveVersion, shouldResolve, src, thumbnailMaxSize, useThumbnail])

  return (
    <Image
      ref={imageRef}
      {...props}
      onLoad={localSrc ? onLoad : undefined}
      src={localSrc || BLANK_IMAGE_SRC}
      alt={alt}
      {...(!props.fill ? { width, height } : {})}
      loading={loading ?? 'lazy'}
      decoding={decoding ?? 'async'}
      unoptimized
    />
  )
}
