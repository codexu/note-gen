'use client'
import Image from "next/image"
import React, { useEffect, useRef, useState } from "react";
import { convertImage } from '@/lib/utils'
import { getCachedRecordImageThumbnailPath, getRecordImageThumbnailPath } from "@/lib/record-image-thumbnail";
import emitter from '@/lib/emitter'

const BLANK_IMAGE_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

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
  onError,
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
  const [resolvedImage, setResolvedImage] = useState<{ src: string; originalSrc: string } | null>(null)
  const [shouldResolve, setShouldResolve] = useState(loading === 'eager')
  const [resolveVersion, setResolveVersion] = useState(0)
  const imageRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const sourcePath = getImageSrcString(src).trim().replace(/^\/+/, '')
    const handleAssetsDownloaded = ({ paths }: { paths: string[] }) => {
      if (!paths.includes(sourcePath)) {
        return
      }

      setResolvedImage(null)
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
      let nextSrc = originalSrc
      if (useThumbnail) {
        const resolveThumbnail = generateThumbnail ? getRecordImageThumbnailPath : getCachedRecordImageThumbnailPath
        const thumbnailPath = await resolveThumbnail(sourcePath, thumbnailMaxSize).catch(() => null)
        if (thumbnailPath) {
          nextSrc = await convertImage(thumbnailPath).catch(() => originalSrc)
        }
      }

      if (cancelled) {
        return
      }

      setResolvedImage({ src: nextSrc, originalSrc })
    }

    void resolveSrc()

    return () => {
      cancelled = true
    }
  }, [generateThumbnail, onResolvedSrc, resolveVersion, shouldResolve, src, thumbnailMaxSize, useThumbnail])

  const handleThumbnailError = resolvedImage && resolvedImage.src !== resolvedImage.originalSrc ? () => {
    const originalSrc = resolvedImage.originalSrc
    setResolvedImage(current => current === resolvedImage ? { src: originalSrc, originalSrc } : current)
  } : undefined

  return (
    <Image
      ref={imageRef}
      {...props}
      onError={handleThumbnailError ?? onError}
      onLoad={resolvedImage?.src ? onLoad : undefined}
      src={resolvedImage?.src || BLANK_IMAGE_SRC}
      alt={alt}
      {...(!props.fill ? { width, height } : {})}
      loading={loading ?? 'lazy'}
      decoding={decoding ?? 'async'}
      unoptimized
    />
  )
}
