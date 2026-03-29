"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { TooltipButton } from "@/components/tooltip-button"
import { useImperativeHandle, forwardRef, useRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import useVectorStore from "@/stores/vector"
import { getContextForQuery, getContextForQueryInFolder } from '@/lib/rag'
import { invoke } from "@tauri-apps/api/core"
import { LinkedResource, isLinkedFolder } from "@/lib/files"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { AgentHandler } from "@/lib/agent/agent-handler"
import { getToolByName } from "@/lib/agent/tools"
import { getSessionApprovalScope, matchesSessionApproval } from "@/lib/agent/session-approval"
import { ImageAttachment } from "./image-attachments"
import type { RagSource } from "@/lib/rag"

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
  const {
    insert,
    loading,
    setLoading,
    saveChat,
    setAgentState,
    maybeCondense,
    linkedResourcePreview,
  } = useChatStore()
  const { isRagEnabled } = useVectorStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const agentHandlerRef = useRef<AgentHandler | null>(null)
  const t = useTranslations()

  // 跟踪上一次的 loading 状态
  const wasLoadingRef = useRef(false)

  // 在 AI 响应完成后，触发压缩检查
  useEffect(() => {
    if (wasLoadingRef.current && !loading) {
      // loading 从 true 变为 false，AI 响应完成
      // 异步触发，不等待完成
      maybeCondense()
    }
    wasLoadingRef.current = loading
  }, [loading, maybeCondense])

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

  const shouldCarryUserHistoryForAgent = (input: string) => {
    const normalized = input.trim().toLowerCase()
    if (!normalized) {
      return false
    }

    return /^(继续|接着|然后|再来|再生成|再做|顺便|另外|刚才|基于刚才|在此基础上|那个|这个|它|继续用|再用)/.test(normalized)
      || /(继续|接着|然后|再来|再生成|再做|顺便|另外|刚才|基于刚才|在此基础上|那个|这个|它)/.test(normalized)
  }

  const buildPartialSuccessContent = (result: string, toolCalls: { result?: { success?: boolean; data?: any; error?: string } }[]) => {
    const generatedOutputFiles = toolCalls.flatMap((toolCall) => {
      const outputFiles = toolCall.result?.data?.output_files
      return Array.isArray(outputFiles) ? outputFiles : []
    })

    const uniqueOutputFiles = Array.from(new Set(generatedOutputFiles.filter((file): file is string => typeof file === 'string' && file.trim().length > 0)))
    if (uniqueOutputFiles.length === 0) {
      return null
    }

    const failedToolCall = [...toolCalls].reverse().find((toolCall) => toolCall.result?.success === false)
    const failureMessage = failedToolCall?.result?.error || result

    return [
      `已成功生成文件：`,
      uniqueOutputFiles.map((file) => `- ${file}`).join('\n'),
      '',
      `后续校验或附加步骤失败：${failureMessage}`,
    ].join('\n')
  }

  const sanitizeAgentFinalContent = (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) {
      return trimmed
    }

    const markers = ['\nThought:', '\nAction:', '\nAction Input:']
    let cutoff = trimmed.length

    for (const marker of markers) {
      const index = trimmed.indexOf(marker)
      if (index !== -1) {
        cutoff = Math.min(cutoff, index)
      }
    }

    const leadingActionIndex = trimmed.search(/^(Thought:|Action:|Action Input:)/)
    if (leadingActionIndex === 0) {
      const finalAnswerMatch = trimmed.match(/Final Answer[:：]\s*([\s\S]*)/i)
      if (finalAnswerMatch) {
        return finalAnswerMatch[1].trim()
      }
    }

    return trimmed.slice(0, cutoff).trim()
  }

  useImperativeHandle(ref, () => ({
    sendChat: handleSubmit
  }))

  // Agent 确认回调 - 使用内联确认而不是弹窗
  const requestConfirmation = (
    toolName: string,
    params: Record<string, any>,
    context?: {
      previewParams?: Record<string, any>
      originalContent?: string
      modifiedContent?: string
      filePath?: string
    }
  ): Promise<boolean> => {
    const tool = getToolByName(toolName)
    const sessionApprovalScope = getSessionApprovalScope(toolName, tool, params)
    const canApproveForSession = !!sessionApprovalScope

    const currentChatState = useChatStore.getState()
    const activeConversationId = currentChatState.currentConversationId
    const autoApproveConversationId = currentChatState.agentAutoApproveConversationId
    const autoApproveRuntimeSkillId = currentChatState.agentAutoApproveRuntimeSkillId

    if (matchesSessionApproval(
      autoApproveConversationId,
      activeConversationId,
      autoApproveRuntimeSkillId,
      sessionApprovalScope
    )) {
      return Promise.resolve(true)
    }

    return new Promise((resolve) => {
      // 将确认请求保存到 store，在对话中显示
      setAgentState({
        pendingConfirmation: {
          toolName,
          params,
          previewParams: context?.previewParams,
          ...context,
          canApproveForSession,
          sessionApprovalType: sessionApprovalScope?.type,
          sessionApprovalSkillId: sessionApprovalScope?.skillId,
        }
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

    setAgentState({
      activeChatId: placeholderMessage.id,
    })

    // 每次都创建新的 AgentHandler，使用当前的 placeholderMessage
    const agentHandler = new AgentHandler({
      activeChatId: placeholderMessage.id,
      requestConfirmation,
      currentQuote: quoteData
        ? {
            fileName: quoteData.fileName,
            startLine: quoteData.startLine,
            endLine: quoteData.endLine,
            from: quoteData.from,
            to: quoteData.to,
            fullContent: quoteData.fullContent,
          }
        : undefined,
      onFinalAnswerRender: (markdownContent) => {
        // 检测到 Final Answer 时触发渲染
        setAgentState({
          activeChatId: placeholderMessage.id,
          isFinalAnswerMode: true,
          finalAnswerContent: markdownContent
        })
      },
      formatAutoFinalAnswer: (key, values) => t(key as any, values),
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

        if (!stopped) {
          const partialSuccessContent = buildPartialSuccessContent(result, agentState.toolCalls)
          if (partialSuccessContent && /^工具 .+执行失败：|^工具 .+执行出错：|^Error:/.test(finalContent.trim())) {
            finalContent = partialSuccessContent
          }
        }

        finalContent = sanitizeAgentFinalContent(finalContent)

        // 获取当前消息状态，保留 ragSources 和 ragSourceDetails
        const currentState = useChatStore.getState()
        const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)

        // 更新占位消息，保留 RAG 相关字段
        await saveChat({
          id: placeholderMessage.id,
          tagId: placeholderMessage.tagId,
          conversationId: placeholderMessage.conversationId,
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

        // 清空 Final Answer 模式状态
        setAgentState({
          activeChatId: undefined,
          isFinalAnswerMode: false,
          finalAnswerContent: undefined
        })

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
          conversationId: placeholderMessage.conversationId,
          role: placeholderMessage.role,
          type: placeholderMessage.type,
          inserted: placeholderMessage.inserted,
          createdAt: placeholderMessage.createdAt,
          // 保留来自 currentMessage 的 RAG 相关字段
          ragSources: currentMessage?.ragSources,
          ragSourceDetails: currentMessage?.ragSourceDetails,
          content: `Error: ${error}`,
        }, true)

        // 清空 Final Answer 模式状态
        setAgentState({
          activeChatId: undefined,
          isFinalAnswerMode: false,
          finalAnswerContent: undefined
        })

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

      // 3. 如果有关联文件（非文件夹），始终注入完整内容作为 Agent 上下文
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

          if (linkedResourcePreview) {
            context += `\n${linkedResourcePreview}\n`
          }

          if (linkedFileContent) {
            context += `\n## 关联文件完整内容\n\nThe full content of the linked file "${linkedResource.name}" (${linkedResource.relativePath}) is already included below. Do not call tools to read or check this same file again unless the user explicitly asks to refresh it.\n\n---\n${linkedFileContent}\n---\n`
          }
        } catch (error) {
          console.error('Failed to read linked file in Agent mode:', error)
        }
      }

      // 4. 如果有引用内容，添加引用上下文（在构建消息之前）
      if (quoteData) {
        const { fileName, startLine, endLine, fullContent, from, to } = quoteData
        let lineInfo = ''
        const hasValidLineNumbers = startLine !== -1 && endLine !== -1
        const hasValidRange = from >= 0 && to >= from

        if (hasValidLineNumbers) {
          if (startLine === endLine) {
            lineInfo = `第 ${startLine} 行`
          } else {
            lineInfo = `第 ${startLine}-${endLine} 行`
          }
        }

        context += `\n## 📌 用户引用内容

用户引用了笔记 "${fileName}" ${lineInfo}的以下内容：

---
${fullContent}
---

${hasValidRange ? `**仅在用户明确要求修改/改写/补充/插入时才允许编辑**。

如果用户是在提问、解释、总结、分析、翻译、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

**🚨 当且仅当用户明确要求修改时，必须精确替换用户选中的范围**: 当前引用内容来自编辑器选区，必须优先使用 replace_editor_content 的 position-based 模式，只替换这段选中的内容：
- from: ${from}
- to: ${to}
- 使用 content 或 replaceContent 传入新内容
- 只允许替换这个选区，禁止扩大到整篇文档或整段之外

**如果用户说“在这段前面/后面/上面/下面插入、补充、添加”**:
- 仍然使用 replace_editor_content
- 基于当前引用范围整体替换
- 前插: 新内容 + 原引用内容
- 后插: 原引用内容 + 新内容
- 不要使用 insert_at_cursor，因为聊天输入会让编辑器失焦，当前光标位置不可靠

**如果用户明确要求“前面和后面都增加内容”**:
- 仍然使用 replace_editor_content
- 必须先分别生成前插内容和后插内容
- 请在传给工具的 content 中使用这个精确格式：
  <<BEFORE>>
  [前插内容]
  <<AFTER>>
  [后插内容]
- 系统会自动把它拼接成：前插内容 + 原引用内容 + 后插内容
- 不要把前后内容合并成一整段普通文本

**兜底行号信息**:
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止改动选区之外的内容
- 禁止获取整个文档后再重写整篇
- 禁止把 startLine/endLine 擅自改成 1/1` : hasValidLineNumbers ? `**🚨 必须使用行号修改**: 当用户引用内容并要求修改时，你必须使用 replace_editor_content 工具的 line-based 模式，传入精确的行号：
` : hasValidLineNumbers ? `**仅在用户明确要求修改/改写/补充/插入时才允许编辑**。

如果用户是在提问、解释、总结、分析、翻译、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

**🚨 当且仅当用户明确要求修改时，必须使用行号修改**: 当用户引用内容并要求修改时，你必须使用 replace_editor_content 工具的 line-based 模式，传入精确的行号：
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}
- 必须使用 replaceContent 参数传入新内容

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止使用 from/to 位置参数
- 禁止使用 searchContent 文本搜索模式
- 禁止获取整个文档内容后再操作` : `**注意**: 此引用内容没有有效的行号信息。如果需要修改，请先使用 get_editor_selection 工具获取当前选中的行号信息。`}

请基于这段引用内容回答用户的问题。

`
      }

      // 5. 构建消息数组，包含对话历史（使用压缩摘要替代已压缩的消息）
      const { chats } = useChatStore.getState()
      const { buildMessagesWithHistory } = await import('@/lib/ai/condense')

      // 使用 buildMessagesWithHistory 构建完整的消息数组
      // 注意：Agent 模式下，不传入 systemPrompt（Agent 会自己构建）
      // 将所有上下文（文章、RAG、关联文件、引用）作为 additionalContext
      const messages = buildMessagesWithHistory(
        chats,
        undefined, // systemPrompt - Agent 会自己构建
        context,   // additionalContext - 包含文章、RAG、关联文件、引用等
        inputValue, // currentUserInput - 当前用户输入
        {
          // Agent 自己会在 think() 里重新注入当前请求，避免重复。
          // 保留 assistant 历史，优先使用 condensedContent，避免丢失多轮上下文。
          includeAssistantMessages: true,
          includeLatestUserMessage: false,
          maxUserMessages: shouldCarryUserHistoryForAgent(inputValue) ? 3 : 0,
        }
      )

      await agentHandler.execute(inputValue, messages, imageUrls)
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
