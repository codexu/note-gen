"use client"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import Image from "next/image"
import { PhotoView } from "react-photo-view"
import { PhotoPreviewProvider } from "@/components/photo-preview-provider"

export interface ImageAttachment {
  id: string
  url: string
  name?: string
  source?: 'paste' | 'file' | 'record'
}

interface ImageAttachmentsProps {
  images: ImageAttachment[]
  onRemove: (id: string) => void
}

export function ImageAttachments({ images, onRemove }: ImageAttachmentsProps) {
  if (images.length === 0) return null

  return (
    <PhotoPreviewProvider>
      <div className="flex flex-wrap gap-2 p-1">
        {images.map((image) => (
          <div
            key={image.id}
            className="relative group rounded-lg overflow-hidden border bg-muted cursor-pointer"
            style={{ width: '40px', height: '40px' }}
          >
            <PhotoView src={image.url}>
              <Image
                src={image.url}
                alt={image.name || 'Attached image'}
                fill
                className="object-cover"
                unoptimized
              />
            </PhotoView>
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-0 right-0 h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(image.id)
              }}
            >
              <X className="h-2.5 w-2.5" />
            </Button>
          </div>
        ))}
      </div>
    </PhotoPreviewProvider>
  )
}
