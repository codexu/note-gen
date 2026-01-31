import { TooltipButton } from "@/components/tooltip-button";
import emitter from "@/lib/emitter";
import useSettingStore from "@/stores/setting";
import { Quote as QuoteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import useArticleStore from "@/stores/article";

export default function Quote({value}: {value?: string}) {
  const { primaryModel } = useSettingStore()
  const t = useTranslations('article.editor.floatbar.quote')
  const { currentArticle, activeFilePath } = useArticleStore()
  
  function handleQuote() {
    if (!value || !currentArticle) return

    // 获取选中文本在文章中的位置
    const lines = currentArticle.split('\n')
    
    // 查找选中文本所在的行
    const searchText = value.trim()
    let startLine = -1
    let endLine = -1
    
    // 尝试找到选中文本的起始和结束行
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i]
      if (startLine === -1 && lineText.includes(searchText.split('\n')[0])) {
        startLine = i + 1 // 行号从1开始
      }
      if (startLine !== -1 && lineText.includes(searchText.split('\n')[searchText.split('\n').length - 1])) {
        endLine = i + 1
        break
      }
    }

    // 构建引用内容
    let quoteContent = ''
    const fileName = activeFilePath?.split('/').pop() || '当前笔记'
    
    if (startLine !== -1 && endLine !== -1) {
      // 如果找到了行号
      if (startLine === endLine) {
        quoteContent = `> 引用自 ${fileName} 第 ${startLine} 行\n> ${value.trim()}\n\n`
      } else {
        quoteContent = `> 引用自 ${fileName} 第 ${startLine}-${endLine} 行\n> ${value.trim()}\n\n`
      }
    } else {
      // 如果没找到行号，显示内容摘要
      const preview = value.length > 50 ? value.substring(0, 50) + '...' : value
      quoteContent = `> 引用自 ${fileName}\n> ${preview}\n\n`
    }

    // 发送引用事件到聊天输入框
    emitter.emit('insert-quote', {
      quote: quoteContent,
      fullContent: value,
      fileName,
      startLine,
      endLine,
      articlePath: activeFilePath
    })

    // 重置选中状态
    emitter.emit('toolbar-reset-selected-text')
  }

  return (
    <TooltipButton 
      disabled={!primaryModel} 
      icon={<QuoteIcon />} 
      tooltipText={t('tooltip')} 
      onClick={handleQuote}
    />
  )
}
