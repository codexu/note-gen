import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { getQuotePreview } from "./quote-preview"

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
  const tControl = useTranslations('record.chat.control')
  const tCommon = useTranslations('common')
  const { fileName, startLine, endLine, fullContent } = quoteData
  const [expanded, setExpanded] = useState(false)

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

  const previewContent = expanded ? fullContent : getQuotePreview(fullContent, 180)
  const canExpand = fullContent.length > previewContent.length

  return (
    <div className="flex items-start gap-2 p-2 mb-2 border rounded-lg bg-muted/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-muted-foreground">
            {getDisplayText()}
          </span>
        </div>
        <div className={`text-xs text-muted-foreground break-words whitespace-pre-wrap ${expanded ? '' : 'line-clamp-4'}`}>
          {previewContent}
        </div>
        {canExpand && (
          <button
            type="button"
            className="mt-1 text-[11px] text-primary"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? tControl('showLess') : tControl('showMore')}
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={onRemove}
        aria-label={tCommon('delete')}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}
