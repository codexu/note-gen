import { useState } from "react";
import { PhotoView } from "react-photo-view";
import { LocalImage } from "./local-image";
import { convertImage } from "@/lib/utils";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { PhotoPreviewProvider } from "@/components/photo-preview-provider";

export function ImageViewer({url, path, imageClassName}: {url: string, path?: string, imageClassName?: string}) {
  const [src, setSrc] = useState('')

  async function init() {
    const res = url.includes('http') ? url : await convertImage(`/${path}/${url}`)
    setSrc(res)
  }

  useEffect(() => {
    init()
  }, [])

  return (
    <PhotoPreviewProvider>
      <PhotoView src={src}>
        <div>
          <LocalImage
            src={url.includes('http') ? url : `/${path}/${url}`}
            alt=""
            className={cn("w-14 h-14 object-cover cursor-pointer", imageClassName)}
          />
        </div>
      </PhotoView>
    </PhotoPreviewProvider>
  )
}
