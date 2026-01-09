import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface QuoteData {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  articlePath: string
}

interface QuoteDisplayProps {
  quoteData: QuoteData
  onRemove: () => void
}

export function QuoteDisplay({ quoteData, onRemove }: QuoteDisplayProps) {
  const { fileName, startLine, endLine, fullContent } = quoteData
  
  // 生成显示文本
  const getDisplayText = () => {
    if (startLine !== -1 && endLine !== -1) {
      if (startLine === endLine) {
        return `引用自 ${fileName} 第 ${startLine} 行`
      } else {
        return `引用自 ${fileName} 第 ${startLine}-${endLine} 行`
      }
    }
    return `引用自 ${fileName}`
  }

  // 生成预览内容
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
