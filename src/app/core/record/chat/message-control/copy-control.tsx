import { TooltipButton } from "@/components/tooltip-button"
import { Chat } from "@/db/chats"
import { Copy, Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { writeText } from "tauri-plugin-clipboard-api"

interface CopyControlProps {
  chat: Chat
  translatedContent?: string
}

export function CopyControl({ chat, translatedContent }: CopyControlProps) {
  const t = useTranslations()
  const [isCopied, setIsCopied] = useState(false)
  
  // 处理复制功能
  async function handleCopy() {
    if (!chat.content || isCopied) return
    
    try {
      // 使用翻译后的内容或原始内容
      let textToCopy = translatedContent || chat.content
      
      // 移除 <thinking> 标签及其内容
      textToCopy = textToCopy.replace(/<thinking[^>]*>[\s\S]*?<thinking>/gi, '')
      
      // 清理多余的空白字符
      textToCopy = textToCopy.trim()
      
      if (!textToCopy) {
        console.warn('复制内容为空')
        return
      }
      
      await writeText(textToCopy)
      setIsCopied(true)
      
      // 2秒后重置复制状态
      setTimeout(() => {
        setIsCopied(false)
      }, 2000)
    } catch (error) {
      console.error('复制失败:', error)
    }
  }

  if (!chat.content || chat.type !== 'chat') {
    return null
  }

  return (
    <>
      <TooltipButton
        icon={
          isCopied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )
        }
        tooltipText={
          isCopied ? t('record.chat.messageControl.copied') : 
          t('record.chat.messageControl.copy')
        }
        onClick={handleCopy}
        variant="ghost"
        size="sm"
        disabled={isCopied}
      />
    </>
  )
}
