import { useEffect, useMemo, useState } from "react"
import { PhotoView } from "react-photo-view"
import { LocalImage } from "./local-image"
import { cn, convertImage, isHttpUrl } from "@/lib/utils"

export function ImageViewer({url, path, imageClassName, interactive = true}: {url?: string | null, path?: string, imageClassName?: string, interactive?: boolean}) {
  const [previewSrc, setPreviewSrc] = useState('')
  const imageSrc = useMemo(() => {
    if (!url) {
      return ''
    }

    return isHttpUrl(url) ? url : `/${path}/${url}`
  }, [path, url])

  useEffect(() => {
    let cancelled = false

    async function resolvePreviewSrc() {
      if (!imageSrc) {
        setPreviewSrc('')
        return
      }

      const nextPreviewSrc = isHttpUrl(imageSrc)
        ? imageSrc
        : await convertImage(imageSrc)

      if (!cancelled) {
        setPreviewSrc(nextPreviewSrc)
      }
    }

    void resolvePreviewSrc()

    return () => {
      cancelled = true
    }
  }, [imageSrc])

  if (!url) {
    return null
  }

  const image = (
    <LocalImage
      src={imageSrc}
      alt=""
      useThumbnail
      onResolvedSrc={setPreviewSrc}
      className={cn("w-14 h-14 object-cover", interactive ? "cursor-pointer" : "cursor-default", imageClassName)}
    />
  )

  if (!interactive || !previewSrc) {
    return image
  }

  return (
    <PhotoView src={previewSrc}>
      <div className="inline-flex">
        {image}
      </div>
    </PhotoView>
  )
}
