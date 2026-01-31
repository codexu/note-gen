"use client"
import Image from "next/image"
import { useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"

interface ChatImagesProps {
  images: string[]
}

export function ChatImages({ images }: ChatImagesProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)

  if (!images || images.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2 my-2">
        {images.map((imageUrl, index) => (
          <div
            key={index}
            className="relative cursor-pointer rounded-lg overflow-hidden border hover:border-primary transition-colors"
            style={{ width: '120px', height: '120px' }}
            onClick={() => setSelectedImage(imageUrl)}
          >
            <Image
              src={imageUrl}
              alt={`Image ${index + 1}`}
              fill
              className="object-cover"
              unoptimized
            />
          </div>
        ))}
      </div>

      {selectedImage && (
        <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] p-0">
            <div className="relative w-full h-full flex items-center justify-center p-4">
              <Image
                src={selectedImage}
                alt="Full size image"
                width={1200}
                height={800}
                className="object-contain max-h-[85vh]"
                unoptimized
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
