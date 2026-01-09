"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import useMarkStore from "@/stores/mark"
import { fetchAiStream } from "@/lib/ai/chat"
import { TooltipButton } from "@/components/tooltip-button"
import { useImperativeHandle, forwardRef, useRef } from "react"
import { useTranslations } from "next-intl"
import useVectorStore from "@/stores/vector"
import { getContextForQuery } from '@/lib/rag'
import { invoke } from "@tauri-apps/api/core"
import { MarkdownFile } from "@/lib/files"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { useMcpStore } from "@/stores/mcp"
import { getOpenAIFunctions } from "@/lib/mcp/tools"
import { AgentHandler } from "@/lib/agent/agent-handler"
import { ImageAttachment } from "./image-attachments"

interface QuoteData {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  articlePath: string
}

interface ChatSendProps {
  inputValue: string;
  onSent?: () => void;
  linkedFile?: MarkdownFile | null;
  attachedImages?: ImageAttachment[];
  quoteData?: QuoteData | null;
}

export const ChatSend = forwardRef<{ sendChat: () => void }, ChatSendProps>(({ inputValue, onSent, linkedFile, attachedImages = [], quoteData = null }, ref) => {
  const { primaryModel } = useSettingStore()
  const { currentTagId } = useTagStore()
  const { insert, loading, setLoading, saveChat, chats, chatMode, setAgentState } = useChatStore()
  const { fetchMarks, marks } = useMarkStore()
  const { isLinkMark } = useChatStore()
  const { isRagEnabled } = useVectorStore()
  const { selectedServerIds } = useMcpStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const agentHandlerRef = useRef<AgentHandler | null>(null)
  const t = useTranslations()

  useImperativeHandle(ref, () => ({
    sendChat: handleSubmit
  }))

  // Agent 确认回调 - 使用内联确认而不是弹窗
  const requestConfirmation = (toolName: string, params: Record<string, any>): Promise<boolean> => {
    return new Promise((resolve) => {
      // 将确认请求保存到 store，在对话中显示
      setAgentState({ 
        pendingConfirmation: { toolName, params }
      })
      
      // 轮询检查用户是否已确认或取消
      const checkInterval = setInterval(() => {
        const currentState = useChatStore.getState()
        
        // 如果 pendingConfirmation 被清除，说明用户已操作
        if (!currentState.agentState.pendingConfirmation) {
          clearInterval(checkInterval)
          // 如果 Agent 仍在运行，说明用户确认了
          resolve(currentState.agentState.isRunning)
        }
      }, 100)
    })
  }

  // Agent 模式处理
  async function handleAgentMode(imageUrls: string[]) {
    // 先创建一个占位的 AI 消息
    const placeholderMessage = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
    })

    if (!placeholderMessage) return

    // 每次都创建新的 AgentHandler，使用当前的 placeholderMessage
    const agentHandler = new AgentHandler({
      requestConfirmation,
      onComplete: async (result, steps) => {
        // 获取 Agent 执行历史，保存完整的 ReAct 步骤
        const { agentState } = useChatStore.getState()
        const agentHistory = {
          steps: steps || [], // 保存完整的 ReAct 步骤（包含 thought, action, observation）
          toolCalls: agentState.toolCalls,
          iterations: agentState.currentIteration,
        }
        
        // 更新占位消息
        await saveChat({
          ...placeholderMessage,
          content: result,
          agentHistory: JSON.stringify(agentHistory),
        }, true)
        
        // 清空 ref
        agentHandlerRef.current = null
      },
      onError: async (error) => {
        // 更新占位消息为错误信息
        await saveChat({
          ...placeholderMessage,
          content: `Error: ${error}`,
        }, true)
        
        // 清空 ref
        agentHandlerRef.current = null
      },
    })

    // 保存到 ref
    agentHandlerRef.current = agentHandler

    try {
      // 构建上下文信息：如果有当前打开的笔记，自动传入其内容
      let context = ''
      const useArticleStore = (await import('@/stores/article')).default
      const articleStore = useArticleStore.getState()
      
      if (articleStore.activeFilePath && articleStore.currentArticle) {
        context = `## 当前打开的笔记\n文件路径: ${articleStore.activeFilePath}\n\n内容:\n${articleStore.currentArticle}`
      }
      
      await agentHandler.execute(inputValue, context, imageUrls)
    } catch (error) {
      console.error('Agent execution error:', error)
    } finally {
      // 清空 ref
      agentHandlerRef.current = null
    }
  }

  // 对话
  async function handleSubmit() {
    if (inputValue === '') return
    onSent?.()
    
    // Agent 模式
    if (chatMode === 'agent') {
      setLoading(true)
      const imageUrls = attachedImages.map(img => img.url)
      await insert({
        tagId: currentTagId,
        role: 'user',
        content: inputValue,
        type: 'chat',
        inserted: false,
        images: imageUrls.length > 0 ? JSON.stringify(imageUrls) : undefined,
        quoteData: quoteData ? JSON.stringify(quoteData) : undefined,
      })
      await handleAgentMode(imageUrls)
      setLoading(false)
      return
    }

    // Chat 模式（原有逻辑）
    setLoading(true)
    const imageUrls = attachedImages.map(img => img.url)
    await insert({
      tagId: currentTagId,
      role: 'user',
      content: inputValue,
      type: 'chat',
      inserted: false,
      image: undefined,
      images: imageUrls.length > 0 ? JSON.stringify(imageUrls) : undefined,
      quoteData: quoteData ? JSON.stringify(quoteData) : undefined,
    })

    const message = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
      image: undefined,
      ragSources: undefined,
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
    let ragSources: string[] = []
    let linkedFileContent = ''
    let quoteContent = ''
    
    // 如果有引用内容，构建引用上下文
    if (quoteData) {
      const { fileName, startLine, endLine, fullContent } = quoteData
      let lineInfo = ''
      if (startLine !== -1 && endLine !== -1) {
        if (startLine === endLine) {
          lineInfo = `第 ${startLine} 行`
        } else {
          lineInfo = `第 ${startLine}-${endLine} 行`
        }
      }
      
      quoteContent = `
用户引用了笔记 "${fileName}" ${lineInfo}的以下内容：
${fullContent}

请基于这段引用内容回答用户的问题。
`
    }
    
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
        const ragResult = await getContextForQuery(keywords)
        ragContext = ragResult.context
        ragSources = ragResult.sources
        
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
      ${quoteContent.trim()}
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
      ragSources: ragSources.length > 0 ? JSON.stringify(ragSources) : undefined,
    }, true)
    
    // 创建新的 AbortController 用于终止请求
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal
    
    // 准备 MCP 工具（如果有选中的服务器）
    let mcpTools: any[] | undefined
    if (selectedServerIds.length > 0) {
      mcpTools = getOpenAIFunctions(selectedServerIds)
    }
    
    // 使用流式方式获取AI结果
    let cache_content = '';
    let cache_thinking = '';
    console.log('[chat-send] Starting fetchAiStream with thinking callback')
    try {
      await fetchAiStream(request_content, async (content) => {
        cache_content = content
        console.log('[chat-send] Content callback, length:', content.length)
        
        // 每次收到流式内容时更新消息
        await saveChat({
          ...message,
          content: content,
          thinking: cache_thinking || undefined
        }, false)
      }, signal, mcpTools, t, message.id, imageUrls, async (thinking) => {
        console.log('[chat-send] Thinking callback received:', thinking.substring(0, 100))
        cache_thinking = thinking
        
        // 每次收到思考内容时更新消息
        await saveChat({
          ...message,
          content: cache_content,
          thinking: thinking
        }, false)
        console.log('[chat-send] Saved chat with thinking, length:', thinking.length)
      })
    } catch (error: any) {
      // 如果不是中止错误，则记录错误信息
      if (error.name !== 'AbortError') {
        console.error('Stream error:', error)
      }
    } finally {
      abortControllerRef.current = null
      setLoading(false)
      
      console.log('[chat-send] Final save - content length:', cache_content.length, 'thinking length:', cache_thinking.length)
      // 最终保存
      await saveChat({
        ...message,
        content: cache_content,
        thinking: cache_thinking || undefined,
        ragSources: ragSources.length > 0 ? JSON.stringify(ragSources) : undefined,
      }, true)
    }
  }

  const handleStop = async () => {
    // 停止普通对话的流式输出
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    
    // 停止 Agent 执行
    if (agentHandlerRef.current) {
      agentHandlerRef.current.stop()
      agentHandlerRef.current = null
    }
    
    // 重置 loading 状态
    setLoading(false)
    
    // 保存终止消息
    const lastChat = chats[chats.length - 1]
    if (lastChat && lastChat.role === 'system') {
      // 如果最后一条消息是系统消息，更新为终止消息
      await saveChat({
        ...lastChat,
        content: t('record.chat.input.stopped'),
      }, true)
    }
  }

  return (
    <>
      <TooltipButton 
        variant={loading ? "destructive" : "default"}
        size="sm"
        icon={loading ? <Square className="size-4" /> : <Send className="size-4" />} 
        disabled={!loading && (!primaryModel || !inputValue.trim())} 
        tooltipText={loading ? t('record.chat.input.stop') : t('record.chat.input.send')} 
        onClick={loading ? handleStop : handleSubmit} 
      />
    </>
  )
})

ChatSend.displayName = 'ChatSend';
