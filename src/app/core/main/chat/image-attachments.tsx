"use client"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PhotoPreviewProvider } from "@/components/photo-preview-provider"
import { LocalImage } from '@/components/local-image'

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
            <LocalImage
              src={image.url}
              alt={image.name || 'Attached image'}
              fill
              className="object-cover"
              unoptimized
            />
            <Button
              variant="destructive"
              size="icon"
              className="absolute right-0 top-0 size-6 opacity-100 transition-opacity md:size-4 md:opacity-0 md:group-hover:opacity-100"
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
