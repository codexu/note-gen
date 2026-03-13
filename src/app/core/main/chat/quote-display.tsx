import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"

interface QuoteData {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
}

interface QuoteDisplayProps {
  quoteData: QuoteData
  onRemove: () => void
}

export function QuoteDisplay({ quoteData, onRemove }: QuoteDisplayProps) {
  const t = useTranslations('editor.quoteDisplay')
  const { fileName, startLine, endLine, fullContent } = quoteData

  // Generate display text
  const getDisplayText = () => {
    if (startLine !== -1 && endLine !== -1) {
      if (startLine === endLine) {
        return t('line', { fileName, line: startLine })
      } else {
        return t('lines', { fileName, start: startLine, end: endLine })
      }
    }
    return t('fromFile', { fileName })
  }

  // Generate preview content
  const getPreviewContent = () => {
    if (fullContent.length > 100) {
      return fullContent.substring(0, 100) + '...'
    }
    return fullContent
  }

  return (
    <div className="flex items-start gap-2 p-2 mb-2 border rounded-lg bg-muted/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-muted-foreground">
            {getDisplayText()}
          </span>
        </div>
        <div className="text-xs text-muted-foreground line-clamp-2 break-words">
          {getPreviewContent()}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}
