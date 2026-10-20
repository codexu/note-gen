"use client"
import { useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { RotateCcw } from "lucide-react"
import type { PersistedChatImageAnalysis } from "@/lib/chat-image-context"
import { LocalImage } from '@/components/local-image'

interface ChatImagesProps {
  images: string[]
  analyses?: PersistedChatImageAnalysis[]
  onRetry?: (analysis: PersistedChatImageAnalysis, index: number) => void
}

export function ChatImages({ images, analyses = [], onRetry }: ChatImagesProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const previewT = useTranslations('record.chat.preview')
  const t = useTranslations('record.chat.input.imageAttachment.analysis')

  if (!images || images.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2 my-2">
        {images.map((imageUrl, index) => {
          const analysis = analyses[index]
          const canRetry = analysis && ['failed', 'cancelled'].includes(analysis.status) && onRetry

          return (
            <div key={analysis?.imageId || imageUrl} className="flex flex-col items-start gap-1">
              <button
                type="button"
                className="relative cursor-pointer overflow-hidden rounded-lg border transition-colors hover:border-primary"
                style={{ width: '120px', height: '120px' }}
                onClick={() => setSelectedImage(imageUrl)}
              >
                <LocalImage
                  src={imageUrl}
                  alt={`Image ${index + 1}`}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </button>
              {canRetry && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  title={analysis.errorMessage}
                  onClick={() => onRetry(analysis, index)}
                >
                  <RotateCcw data-icon="inline-start" />
                  {t('retry')}
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {selectedImage && (
        <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] p-0">
            <DialogTitle className="sr-only">{previewT('image')}</DialogTitle>
            <div className="relative w-full h-full flex items-center justify-center p-4">
              <LocalImage
                src={selectedImage}
                alt={previewT('image')}
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
