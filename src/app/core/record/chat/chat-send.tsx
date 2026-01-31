"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { TooltipButton } from "@/components/tooltip-button"
import { useImperativeHandle, forwardRef, useRef } from "react"
import { useTranslations } from "next-intl"
import useVectorStore from "@/stores/vector"
import { getContextForQuery, getContextForQueryInFolder } from '@/lib/rag'
import { invoke } from "@tauri-apps/api/core"
import { LinkedResource, isLinkedFolder } from "@/lib/files"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { AgentHandler } from "@/lib/agent/agent-handler"
import { ImageAttachment } from "./image-attachments"
import type { RagSource } from "@/lib/rag"

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
  linkedResource?: LinkedResource | null;
  attachedImages?: ImageAttachment[];
  quoteData?: QuoteData | null;
}

export const ChatSend = forwardRef<{ sendChat: () => void }, ChatSendProps>(({ inputValue, onSent, linkedResource, attachedImages = [], quoteData = null }, ref) => {
  const { primaryModel } = useSettingStore()
  const { currentTagId } = useTagStore()
  const { insert, loading, setLoading, saveChat, setAgentState } = useChatStore()
  const { isRagEnabled } = useVectorStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const agentHandlerRef = useRef<AgentHandler | null>(null)
  const t = useTranslations()

  // RAG 关键词停用词过滤
  // 过滤掉没有实际检索意义的虚词
  const filterRAGKeywords = (keywords: {text: string, weight: number}[]) => {
    const stopWords = new Set([
      // 中文虚词/系动词
      '的', '了', '是', '在', '有', '和', '就', '不', '人', '都', '一', '一个',
      '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
      '好', '自己', '这', '那', '里', '就是', '为', '与', '之', '用', '可以',
      '但', '而', '或', '及', '等', '对', '把', '被', '让', '给', '从', '向',
      '什么', '怎么', '怎样', '如何', '为什么', '哪些', '多少',

      // 英文停用词
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
      'what', 'how', 'why', 'where', 'when', 'who', 'which'
    ])

    return keywords.filter(k => {
      const text = k.text.trim().toLowerCase()
      // 过滤掉停用词和单字
      return !stopWords.has(text) && text.length > 1
    })
  }

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
      onComplete: async (result, steps, stopped) => {
        // 获取 Agent 执行历史，保存完整的 ReAct 步骤
        const { agentState } = useChatStore.getState()
        // 使用 agentState.completedSteps 而不是 steps 参数，因为 completedSteps 包含 duration 信息
        const agentHistory = {
          steps: agentState.completedSteps || [], // 保存完整的 ReAct 步骤（包含 thought, action, observation, duration）
          toolCalls: agentState.toolCalls,
          iterations: agentState.currentIteration,
        }

        // 如果是被终止的，构建包含终止信息的消息
        let finalContent = result
        if (stopped) {
          // 保留已产生的步骤，并添加终止信息
          const stepCount = agentState.completedSteps?.length || 0
          if (stepCount > 0) {
            // 有已完成的步骤，显示这些步骤的内容
            finalContent = `${t('record.chat.input.stopped')}\n\n已完成 ${stepCount} 个步骤：\n${agentState.completedSteps!.map((step, i) =>
              `${i + 1}. ${step.action?.tool || '思考'}`
            ).join('\n')}`
          } else {
            // 没有已完成步骤，显示简单的终止信息
            finalContent = t('record.chat.input.stopped')
          }
        }

        // 获取当前消息状态，保留 ragSources 和 ragSourceDetails
        const currentState = useChatStore.getState()
        const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)

        // 更新占位消息，保留 RAG 相关字段
        await saveChat({
          id: placeholderMessage.id,
          tagId: placeholderMessage.tagId,
          role: placeholderMessage.role,
          type: placeholderMessage.type,
          inserted: placeholderMessage.inserted,
          createdAt: placeholderMessage.createdAt,
          // 保留来自 currentMessage 的 RAG 相关字段
          ragSources: currentMessage?.ragSources,
          ragSourceDetails: currentMessage?.ragSourceDetails,
          // 设置新的内容
          content: finalContent,
          agentHistory: JSON.stringify(agentHistory),
        }, true)

        // 清空 ref
        agentHandlerRef.current = null
      },
      onError: async (error) => {
        // 获取当前消息状态，保留 ragSources 和 ragSourceDetails
        const currentState = useChatStore.getState()
        const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)

        // 更新占位消息为错误信息，保留 RAG 相关字段
        await saveChat({
          id: placeholderMessage.id,
          tagId: placeholderMessage.tagId,
          role: placeholderMessage.role,
          type: placeholderMessage.type,
          inserted: placeholderMessage.inserted,
          createdAt: placeholderMessage.createdAt,
          // 保留来自 currentMessage 的 RAG 相关字段
          ragSources: currentMessage?.ragSources,
          ragSourceDetails: currentMessage?.ragSourceDetails,
          content: `Error: ${error}`,
        }, true)

        // 清空 ref
        agentHandlerRef.current = null
      },
    })

    // 保存到 ref
    agentHandlerRef.current = agentHandler

    try {
      // 构建上下文信息
      let context = ''
      let ragSources: string[] = []
      let ragSourceDetails: RagSource[] = []

      // 1. 如果有当前打开的笔记，自动传入其内容
      const useArticleStore = (await import('@/stores/article')).default
      const articleStore = useArticleStore.getState()

      if (articleStore.activeFilePath && articleStore.currentArticle) {
        context = `## 当前打开的笔记\n文件路径: ${articleStore.activeFilePath}\n\n内容:\n${articleStore.currentArticle}\n\n`
      }

      // 2. 如果启用 RAG，获取知识库相关上下文
      if (isRagEnabled) {
        try {
          // 基于 TextRank 算法提取前 15 个关键词（增加数量以提高召回率）
          let keywords = await invoke<{text: string, weight: number}[]>('rank_keywords', { text: inputValue, topK: 15 })

          // 过滤掉停用词（如"是"、"的"等没有检索意义的虚词）
          keywords = filterRAGKeywords(keywords)

          // 如果过滤后没有有效关键词，明确告知
          if (keywords.length === 0) {
            context += `## 知识库检索结果\n\n由于用户问题中没有有效的关键词（仅包含停用词如"的"、"是"等），无法进行知识库检索。如果用户询问的是具体笔记内容，请告知用户需要提供更多具体信息。\n`
          } else {
            // 根据关联资源类型选择检索方式
            let ragResult: { context: string; sources: string[]; sourceDetails: RagSource[] }

            if (linkedResource && isLinkedFolder(linkedResource)) {
              // 文件夹关联：限定检索范围到文件夹
              ragResult = await getContextForQueryInFolder(keywords, linkedResource.relativePath)
            } else {
              // 文件关联或无关联：全局检索
              ragResult = await getContextForQuery(keywords)
            }

            ragSources = ragResult.sources
            ragSourceDetails = ragResult.sourceDetails

            // 设置到 agentState，用于实时显示
            setAgentState({
              ragSources,
              ragSourceDetails,
            })

            if (ragResult.context) {
              // 找到相关内容
              context += `## 知识库检索结果\n\n已在知识库中找到与用户问题相关的笔记内容。请优先使用以下信息回答用户问题：\n\n${ragResult.context}\n`
            } else {
              // 未找到相关内容
              const searchScope = linkedResource && isLinkedFolder(linkedResource)
                ? `在关联文件夹"${linkedResource.name}"中`
                : '在知识库中'

              context += `## 知识库检索结果\n\n${searchScope}未找到与用户问题相关的笔记内容。\n\n请根据情况处理：\n- 如果用户询问的是具体笔记内容，请告知用户${searchScope}可能没有相关资料\n- 如果问题可以基于一般知识回答，请使用你的知识回答\n- 如果需要更多信息，可以请用户提供更具体的关键词或问题\n`
            }
          }
        } catch (error) {
          console.error('Failed to get RAG context in Agent mode:', error)
          // 检索出错时的处理
          context += `## 知识库检索结果\n\n知识库检索过程中出现错误。如果用户询问的是具体笔记内容，请告知用户暂时无法访问知识库。\n`
        }
      }

      // 保存 RAG 来源到消息中（在 Agent 执行前保存，这样引用文件会在最上方显示）
      if (ragSources.length > 0) {
        await saveChat({
          ...placeholderMessage,
          ragSources: JSON.stringify(ragSources),
          ragSourceDetails: ragSourceDetails.length > 0 ? JSON.stringify(ragSourceDetails) : undefined,
        }, true)
      }

      // 3. 如果有关联文件（非文件夹），读取文件内容
      if (linkedResource && !isLinkedFolder(linkedResource)) {
        try {
          const workspace = await getWorkspacePath()
          let linkedFileContent = ''
          if (workspace.isCustom) {
            linkedFileContent = await readTextFile(linkedResource.path)
          } else {
            const { path, baseDir } = await getFilePathOptions(linkedResource.path)
            linkedFileContent = await readTextFile(path, { baseDir })
          }

          if (linkedFileContent) {
            context += `\n## 关联文件内容\n\nThe following is the content of the linked file "${linkedResource.name}" (${linkedResource.relativePath}):\n${linkedFileContent}\n`
          }
        } catch (error) {
          console.error('Failed to read linked file in Agent mode:', error)
        }
      }

      // 4. 如果有引用内容，添加引用上下文
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

        context += `\n## 引用内容\n\n用户引用了笔记 "${fileName}" ${lineInfo}的以下内容：\n${fullContent}\n\n请基于这段引用内容回答用户的问题。\n`
      }

      await agentHandler.execute(inputValue, context, imageUrls)
    } catch (error) {
      console.error('Agent execution error:', error)
    } finally {
      // 清空 ref
      agentHandlerRef.current = null
    }
  }

  // 对话（Agent 模式）
  async function handleSubmit() {
    if (inputValue === '') return
    onSent?.()

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
      // 不立即清空 ref，等待 Agent 的错误处理完成并调用 onComplete
    }

    // 重置 loading 状态
    setLoading(false)
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
