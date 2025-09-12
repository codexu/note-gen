"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import { fetchAiStream } from "@/lib/ai"
import { TooltipButton } from "@/components/tooltip-button"
import { useImperativeHandle, forwardRef, useRef } from "react"
import { useTranslations } from "next-intl"
import useVectorStore from "@/stores/vector"
import { getContextForQuery } from '@/lib/rag'
import { invoke } from "@tauri-apps/api/core"
import { MarkdownFile } from "@/lib/files"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"

interface ChatSendProps {
  inputValue: string;
  onSent?: () => void;
  linkedFile?: MarkdownFile | null;
}

export const ChatSend = forwardRef<{ sendChat: () => void }, ChatSendProps>(({ inputValue, onSent, linkedFile }, ref) => {
  const { primaryModel } = useSettingStore()
  const { currentTagId } = useTagStore()
  const { insert, loading, setLoading, saveChat, chats, locale } = useChatStore()
  const { fetchMarks, marks } = useMarkStore()
  const { isLinkMark } = useChatStore()
  const { isRagEnabled } = useVectorStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const t = useTranslations()

  useImperativeHandle(ref, () => ({
    sendChat: handleSubmit
  }))

  // 对话
  async function handleSubmit() {
    if (inputValue === '') return
    onSent?.()
    
    setLoading(true)
    await insert({
      tagId: currentTagId,
      role: 'user',
      content: inputValue,
      type: 'chat',
      inserted: false,
      image: undefined,
    })

    const message = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
      image: undefined,
    })
    if (!message) return

    await fetchMarks()
    const scanMarks = isLinkMark ? marks.filter(item => item.type === 'scan') : []
    const textMarks = isLinkMark ? marks.filter(item => item.type === 'text') : []
    const imageMarks = isLinkMark ? marks.filter(item => item.type === 'image') : []
    const linkMarks = isLinkMark ? marks.filter(item => item.type === 'link') : []
    const fileMarks = isLinkMark ? marks.filter(item => item.type === 'file') : []
    const lastClearIndex = chats.findLastIndex(item => item.type === 'clear')
    const chatsAfterClear = chats.slice(lastClearIndex + 1)
    
    // 准备请求内容
    let ragContext = ''
    let linkedFileContent = ''
    
    // 如果有关联文件，读取文件内容
    if (linkedFile) {
      try {
        const workspace = await getWorkspacePath()
        if (workspace.isCustom) {
          linkedFileContent = await readTextFile(linkedFile.path)
        } else {
          const { path, baseDir } = await getFilePathOptions(linkedFile.path)
          linkedFileContent = await readTextFile(path, { baseDir })
        }
        
        if (linkedFileContent) {
          linkedFileContent = `
The following is the content of the linked file "${linkedFile.name}" (${linkedFile.relativePath}):
${linkedFileContent}
`
        }
      } catch (error) {
        console.error('Failed to read linked file:', error)
      }
    }
    
    // 如果启用RAG，获取相关上下文
    if (isRagEnabled) {
      try {
        // 基于TextRank算法提取前3个关键词
        const keywords = await invoke<{text: string, weight: number}[]>('rank_keywords', { text: inputValue, topK: 5 })
        // 获取相关文档内容
        ragContext = await getContextForQuery(keywords)
        
        if (ragContext) {
          // 如果获取到了相关内容，将其作为独立部分添加到请求中
          ragContext = `
Your knowledge library is the most relevant content related to this question. Please use these information to answer the question:
${ragContext}
`
        }
      } catch (error) {
        console.error('Failed to get RAG context:', error)
      }
    }

    const request_content = `
      Use ${locale} language, don't use any other language.
      ${[...scanMarks, ...textMarks, ...imageMarks, ...fileMarks, ...linkMarks].length ? 'You can refer to the following content notes:' : ''}
      ${scanMarks.length ? 'The following are screenshots after using OCR to identify text fragments:' : ''}
      ${scanMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n')}
      ${textMarks.length ? 'The following are text copy records:' : ''}
      ${textMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n')}
      ${imageMarks.length ? 'The following are image records:' : ''}
      ${imageMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n')}
      ${linkMarks.length ? 'The following are link records:' : ''}
      ${linkMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n')}
      ${fileMarks.length ? 'The following are file records:' : ''}
      ${fileMarks.map((item, index) => `${index + 1}. ${item.content}`).join(';\n\n')}
      ${chatsAfterClear.length ? 'Refer to the following chat records:' : ''}
      ${
        chatsAfterClear
          .filter((item) => item.tagId === currentTagId && item.type === "chat")
          .map((item, index) => `${index + 1}. ${item.content}`)
          .join(';\n\n')
      }
      ${linkedFileContent.trim()}
      ${ragContext.trim()}
      ${inputValue.trim()}
    `.trim()

    // 先保存空消息，然后通过流式请求更新
    await saveChat({
      ...message,
      content: '',
    }, true)
    
    // 创建新的 AbortController 用于终止请求
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal
    
    // 使用流式方式获取AI结果
    let cache_content = '';
    try {
      await fetchAiStream(request_content, async (content) => {
        cache_content = content
        // 每次收到流式内容时更新消息
        await saveChat({
          ...message,
          content
        }, false)
      }, signal)
    } catch (error: any) {
      // 如果不是中止错误，则记录错误信息
      if (error.name !== 'AbortError') {
        console.error('Stream error:', error)
      }
    } finally {
      abortControllerRef.current = null
      setLoading(false)
      await saveChat({
        ...message,
        content: cache_content
      }, true)
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  return (
    <TooltipButton 
      variant={loading ? "destructive" : "default"}
      size="sm"
      icon={loading ? <Square className="size-4" /> : <Send className="size-4" />} 
      disabled={!loading && (!primaryModel || !inputValue.trim())} 
      tooltipText={loading ? t('record.chat.input.stop') : t('record.chat.input.send')} 
      onClick={loading ? handleStop : handleSubmit} 
    />
  )
})

ChatSend.displayName = 'ChatSend';
