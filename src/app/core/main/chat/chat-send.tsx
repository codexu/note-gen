"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { TooltipButton } from "@/components/tooltip-button"
import { useEffect, useImperativeHandle, forwardRef, useRef } from "react"
import { useTranslations } from "next-intl"
import { LinkedResource, isLinkedFolder, type MarkdownFile } from "@/lib/files"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { AgentHandler } from "@/lib/agent/agent-handler"
import { agentSessionManager } from '@/lib/agent/agent-session-manager'
import { isRequestAbortError } from "@/lib/agent/runtime"
import { agentDebugLog, previewText } from "@/lib/agent/debug-log"
import { getToolByName } from "@/lib/agent/tools"
import { getSessionApprovalScope, matchesSessionApproval } from "@/lib/agent/session-approval"
import { ImageAttachment } from "./image-attachments"
import { cn } from "@/lib/utils"
import type { AgentTraceEvent } from "@/lib/agent/types"
import type { AgentApprovalDecision, AgentSteeringPayload } from "@/lib/agent/types"
import { serializeChatAttachments, type RuntimeChatAttachment } from '@/lib/chat-attachments'
import { retainCompletedAgentTraceEvents } from '@/lib/agent/trace-retention'
import { getAISettingsByModelId } from '@/lib/ai/utils'
import { applyChatReasoningOverride } from '@/lib/ai/chat-reasoning'
import type { AiConfig } from '@/app/core/setting/config'
import {
  buildChatImageContext,
  buildHistoricalImageContext,
  collectAgentImageAttachments,
  createPendingChatImageAnalyses,
  serializeChatImageAnalyses,
  type PersistedChatImageAnalysis,
} from '@/lib/chat-image-context'
import type { Chat } from '@/db/chats'
import {
  confirmEstimatedContextWindow,
  learnContextWindow,
  parseContextOverflowError,
  reduceLearnedContextWindow,
} from '@/lib/ai/model-capacity'
import type { CanvasSelectionContext } from '@/types/canvas'
import { useIsMobile } from '@/hooks/use-mobile'
import { chatAgentStateAdapter } from './chat-agent-state-adapter'
import { chatAgentResourceAdapter } from './chat-agent-resource-adapter'
import {
  buildAgentSteeringContext,
  buildCanvasSelectionContext,
  buildMentionedContext,
  getContextualArticleSnapshot,
  type AgentQuoteData,
  type AgentRequestSnapshot,
} from './agent-session-context'
import { useChatAgentSession } from './use-chat-agent-session'

function getLastDisplayableAgentContent(
  liveContent: string | undefined,
  traceEvents: AgentTraceEvent[]
) {
  const currentContent = liveContent?.trim()
  if (currentContent) {
    return currentContent
  }

  for (let index = traceEvents.length - 1; index >= 0; index -= 1) {
    const event = traceEvents[index]
    if (
      (event.type === 'model_call' || event.type === 'model_response')
      && typeof event.output === 'string'
      && event.output.trim()
    ) {
      return event.output.trim()
    }

    if (event.type === 'final' && event.message?.trim()) {
      return event.message.trim()
    }
  }

  return ''
}

function isUnknownProviderError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return /500 Internal Server Error/i.test(text)
    && /"code"\s*:\s*60000/.test(text)
    && /Unknown error/i.test(text)
}

interface ChatSendProps {
  inputValue: string;
  onSent?: () => void;
  linkedResource?: LinkedResource | null;
  attachedImages?: ImageAttachment[];
  fileAttachments?: RuntimeChatAttachment[];
  quoteData?: AgentQuoteData | null;
  canvasSelectionContext?: CanvasSelectionContext | null;
  selectedSkillIds?: string[];
  mentionedFiles?: MarkdownFile[];
  mentionedRecords?: AgentQuoteData[];
  mentionedCanvases?: CanvasSelectionContext[];
  dockStyle?: boolean;
}

export interface ChatSendHandle {
  sendChat: () => void
  sendPrompt: (prompt: string) => void
}

export const ChatSend = forwardRef<ChatSendHandle, ChatSendProps>(({
  inputValue,
  onSent,
  linkedResource,
  attachedImages = [],
  fileAttachments = [],
  quoteData = null,
  canvasSelectionContext = null,
  selectedSkillIds = [],
  mentionedFiles = [],
  mentionedRecords = [],
  mentionedCanvases = [],
  dockStyle = false,
}, ref) => {
  const { primaryModel, agentPermissionMode } = useSettingStore()
  const { currentTagId } = useTagStore()
  const {
    insert,
    loading,
    setLoading,
    saveChat,
    setAgentState,
    linkedResourcePreview,
  } = useChatStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const imageAnalysisAbortControllerRef = useRef<AbortController | null>(null)
  const steeringImageAnalysisAbortControllerRef = useRef<AbortController | null>(null)
  const manualStopRequestedRef = useRef(false)
  const repeatedScriptApprovalRef = useRef<{ signature: string; count: number }>({ signature: '', count: 0 })
  const contextOverflowRetryRef = useRef(0)
  const t = useTranslations()
  const isMobile = useIsMobile()
  const { session: agentSession, sessionId: agentSessionId } = useChatAgentSession()

  useEffect(() => agentSession.subscribe(event => {
    if (event.type === 'streaming_changed') {
      setLoading(event.isStreaming)
    }
  }), [agentSession])

  const createRequestSnapshot = (overrideText?: string): AgentRequestSnapshot => ({
    reasoningOverride: useChatStore.getState().reasoningOverride,
    inputValue: overrideText ?? inputValue,
    requestText: (overrideText ?? inputValue).trim() || t('record.chat.input.addAttachment.attachmentOnlyPrompt'),
    linkedResource,
    linkedResourcePreview,
    images: [...attachedImages],
    fileAttachments: [...fileAttachments],
    quoteData,
    canvasSelectionContext,
    selectedSkillIds: [...selectedSkillIds],
    mentionedFiles: [...mentionedFiles],
    mentionedRecords: [...mentionedRecords],
    mentionedCanvases: [...mentionedCanvases],
  })

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

  const startProactiveCompaction = () => {
    const chatState = useChatStore.getState()
    if (
      chatState.isTemporaryConversation
      || !chatState.currentConversationId
    ) {
      return
    }

    const conversationId = chatState.currentConversationId
    void Promise.all([
      import('@/lib/ai/condense'),
      import('@/stores/article'),
    ])
      .then(([{ prepareConversationHistory }, { default: useArticleStore }]) => {
        const latestChatState = useChatStore.getState()
        if (latestChatState.currentConversationId !== conversationId) {
          return
        }

        const articleState = useArticleStore.getState()
        const activeArticle = getContextualArticleSnapshot(articleState, isMobile)
        const additionalContext = activeArticle.activeFilePath
          ? activeArticle.currentArticle || ''
          : ''

        return prepareConversationHistory({
          conversationId,
          chats: latestChatState.chats,
          currentUserInput: '',
          additionalContext,
          imageCount: 0,
          proactive: true,
        })
      })
      .catch(error => {
        console.error('[ConversationCompaction] Background compaction failed:', error)
      })
  }

  useImperativeHandle(ref, () => ({
    sendChat: () => void handleSubmit(),
    sendPrompt: (prompt: string) => void handleSubmit(prompt),
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
      from?: number
      to?: number
    }
  ): Promise<AgentApprovalDecision> => {
    const tool = getToolByName(toolName)
    const sessionApprovalScope = getSessionApprovalScope(toolName, tool, params)
    const canApproveForSession = !!sessionApprovalScope
    const approvalSignature = sessionApprovalScope
      ? `${toolName}:${JSON.stringify(params)}`
      : ''
    if (approvalSignature) {
      repeatedScriptApprovalRef.current = repeatedScriptApprovalRef.current.signature === approvalSignature
        ? { signature: approvalSignature, count: repeatedScriptApprovalRef.current.count + 1 }
        : { signature: approvalSignature, count: 1 }
    }
    const requiresRepeatConfirmation = repeatedScriptApprovalRef.current.count >= 3
    if (requiresRepeatConfirmation) {
      repeatedScriptApprovalRef.current = { signature: '', count: 0 }
    }

    const currentChatState = useChatStore.getState()
    const activeConversationId = currentChatState.currentConversationId
    const autoApproveConversationId = currentChatState.agentAutoApproveConversationId
    const autoApproveRuntimeScriptKey = currentChatState.agentAutoApproveRuntimeScriptKey

    if (!requiresRepeatConfirmation && matchesSessionApproval(
      autoApproveConversationId,
      activeConversationId,
      autoApproveRuntimeScriptKey,
      sessionApprovalScope
    )) {
      agentDebugLog('approval_auto_approved', {
        toolName,
        params,
        activeConversationId,
        sessionApprovalScope,
      })
      return Promise.resolve('approved')
    }

    return new Promise((resolve) => {
      agentDebugLog('approval_pending_set', {
        toolName,
        params,
        context,
        canApproveForSession,
        sessionApprovalScope,
      })

      // 将确认请求保存到 store，在对话中显示
      setAgentState({
        pendingConfirmation: {
          toolName,
          params,
          previewParams: context?.previewParams,
          ...context,
          canApproveForSession,
          sessionApprovalType: sessionApprovalScope?.type,
          sessionApprovalKey: sessionApprovalScope?.permissionKey,
        }
      })
      
      // 轮询检查用户是否已确认或取消
      const checkInterval = setInterval(() => {
        const currentState = useChatStore.getState()
        
        // 如果 pendingConfirmation 被清除，说明用户已操作
        if (!currentState.agentState.pendingConfirmation) {
          clearInterval(checkInterval)
          const latestRecord = [...currentState.agentState.confirmationHistory]
            .reverse()
            .find((record) =>
              record.toolName === toolName &&
              JSON.stringify(record.params) === JSON.stringify(params)
            )

          agentDebugLog('approval_pending_resolved', {
            toolName,
            params,
            latestRecord,
            resolved: latestRecord?.status === 'confirmed',
          })

          resolve(latestRecord?.status === 'confirmed'
            ? 'approved'
            : latestRecord?.status === 'superseded'
              ? 'steered'
              : 'denied')
        }
      }, 100)
    })
  }

  // Agent 模式处理
  async function handleAgentMode(
    request: AgentRequestSnapshot,
    userMessage: Chat,
    modelSnapshot: { id: string; name: string; config?: AiConfig }
  ) {
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

    const useArticleStore = (await import('@/stores/article')).default
    const articleStore = useArticleStore.getState()
    const activeArticle = getContextualArticleSnapshot(articleStore, isMobile)
    const useCanvasStore = (await import('@/stores/canvas')).default
    const canvasStore = useCanvasStore.getState()
    const mobileContexts = useChatStore.getState().mobileActiveContexts
    const activeCanvasId = !isMobile || mobileContexts.canvasId
      ? canvasStore.activeCanvasId
      : null
    let pendingCapacityProbe: { contextWindow: number } | undefined
    let deferredOverflowError: string | undefined
    let contextCapacityProbeActive = false
    const agentImageAttachments = collectAgentImageAttachments(
      useChatStore.getState().chats.filter(chat => chat.id !== userMessage.id)
    )

    const persistAgentError = async (error: string) => {
      const currentState = useChatStore.getState()
      const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
      const resolvedRagSources = currentState.agentState.ragSources?.length
        ? JSON.stringify(currentState.agentState.ragSources)
        : currentMessage?.ragSources
      const resolvedRagSourceDetails = currentState.agentState.ragSourceDetails?.length
        ? JSON.stringify(currentState.agentState.ragSourceDetails)
        : currentMessage?.ragSourceDetails
      const aborted = manualStopRequestedRef.current || isRequestAbortError(error)
      const preservedContent = getLastDisplayableAgentContent(
        currentState.agentState.finalAnswerContent,
        currentState.agentState.traceEvents || []
      )
      const stoppedAt = Date.now()
      const completedTraceEvents = (currentState.agentState.traceEvents || []).map(event => {
        if (event.status !== 'running') {
          return event
        }

        return {
          ...event,
          status: aborted ? 'success' as const : 'error' as const,
          duration: event.duration ?? Math.max(0, stoppedAt - event.timestamp),
        }
      })
      const traceEvents = retainCompletedAgentTraceEvents(completedTraceEvents)
      const agentHistory = {
        modelId: modelSnapshot.id,
        modelName: modelSnapshot.name,
        steps: currentState.agentState.completedSteps || [],
        toolCalls: currentState.agentState.toolCalls,
        traceEvents,
        changes: currentState.agentState.changes || [],
        runId: currentState.agentState.runId,
        status: aborted ? 'stopped' : 'failed',
        loadedSkills: currentState.agentState.loadedSkills || [],
        selectedSkills: currentState.agentState.selectedSkills || [],
        iterations: currentState.agentState.currentIteration,
      }

      await saveChat({
        id: placeholderMessage.id,
        tagId: placeholderMessage.tagId,
        conversationId: placeholderMessage.conversationId,
        role: placeholderMessage.role,
        type: placeholderMessage.type,
        inserted: placeholderMessage.inserted,
        createdAt: placeholderMessage.createdAt,
        ragSources: resolvedRagSources,
        ragSourceDetails: resolvedRagSourceDetails,
        content: aborted
          ? preservedContent || t('record.chat.input.stopped')
          : `Error: ${error}`,
        agentHistory: JSON.stringify(agentHistory),
      }, true)

      setAgentState({
        activeChatId: undefined,
        isFinalAnswerMode: false,
        finalAnswerContent: undefined,
        status: aborted ? 'stopped' : 'failed',
        isRunning: false,
        isThinking: false,
        traceEvents,
      })
    }

    // 每次都创建新的 AgentHandler，使用当前的 placeholderMessage
    const agentHandler = new AgentHandler({
      stateAdapter: chatAgentStateAdapter,
      resourceAdapter: chatAgentResourceAdapter,
      activeChatId: placeholderMessage.id,
      modelId: modelSnapshot.id,
      modelName: modelSnapshot.name,
      aiConfig: modelSnapshot.config,
      conversationId: placeholderMessage.conversationId,
      workspaceId: useSettingStore.getState().workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '') || 'default',
      useMemories: !useChatStore.getState().isTemporaryConversation,
      activeFilePath: activeArticle.activeFilePath,
      activeCanvasId: activeCanvasId || undefined,
      permissionMode: agentPermissionMode,
      requestConfirmation,
      currentQuote: request.quoteData
        ? {
            fileName: request.quoteData.fileName,
            articlePath: request.quoteData.articlePath,
            startLine: request.quoteData.startLine,
            endLine: request.quoteData.endLine,
            from: request.quoteData.from,
            to: request.quoteData.to,
            fullContent: request.quoteData.fullContent,
            selectionToken: request.quoteData.selectionToken,
          }
        : undefined,
      attachments: request.fileAttachments,
      imageAttachments: agentImageAttachments,
      selectedSkills: request.selectedSkillIds,
      onSteeringDelivered: sequences => agentSession.acknowledgeSteering(sequences),
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
        deferredOverflowError = undefined
        // 获取 Agent 执行历史，保存结构化运行轨迹
        const { agentState } = useChatStore.getState()
        const effectivelyStopped = Boolean(stopped)
          || manualStopRequestedRef.current
          || isRequestAbortError(result)
        if (!effectivelyStopped && pendingCapacityProbe) {
          const aiConfig = modelSnapshot.config
          if (aiConfig) {
            await confirmEstimatedContextWindow(
              aiConfig,
              pendingCapacityProbe.contextWindow
            )
          }
          pendingCapacityProbe = undefined
        }
        const completedAt = Date.now()
        const completedTraceEvents = (agentState.traceEvents || []).map(event => {
          if (event.status !== 'running') {
            return event
          }

          return {
            ...event,
            status: effectivelyStopped ? 'success' as const : event.status,
            duration: event.duration ?? Math.max(0, completedAt - event.timestamp),
          }
        })
        const traceEvents = retainCompletedAgentTraceEvents(completedTraceEvents)
        // 使用 agentState.completedSteps 而不是 steps 参数，因为 completedSteps 包含 duration 信息
        const agentHistory = {
          modelId: modelSnapshot.id,
          modelName: modelSnapshot.name,
          steps: agentState.completedSteps || [],
          toolCalls: agentState.toolCalls,
          traceEvents,
          changes: agentState.changes || [],
          runId: agentState.runId,
          status: effectivelyStopped ? 'stopped' : agentState.status,
          loadedSkills: agentState.loadedSkills || [],
          selectedSkills: agentState.selectedSkills || [],
          iterations: agentState.currentIteration,
        }

        let finalContent = result
        if (effectivelyStopped) {
          const lastDisplayableContent = getLastDisplayableAgentContent(
            agentState.finalAnswerContent,
            completedTraceEvents
          )
          if (lastDisplayableContent) {
            finalContent = lastDisplayableContent
          } else if (isRequestAbortError(finalContent)) {
            finalContent = ''
          }
        }
        if (effectivelyStopped && !finalContent.trim()) {
          // 只有尚未产生任何正文时才显示终止提示；已有的流式正文原样保留。
          finalContent = t('record.chat.input.stopped')
        }

        if (!effectivelyStopped) {
          const partialSuccessContent = buildPartialSuccessContent(result, agentState.toolCalls)
          if (partialSuccessContent && /^工具 .+执行失败：|^工具 .+执行出错：|^Error:/.test(finalContent.trim())) {
            finalContent = partialSuccessContent
          }
        }

        finalContent = sanitizeAgentFinalContent(finalContent)

        const currentState = useChatStore.getState()
        const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
        const resolvedRagSources = agentState.ragSources?.length
          ? JSON.stringify(agentState.ragSources)
          : currentMessage?.ragSources
        const resolvedRagSourceDetails = agentState.ragSourceDetails?.length
          ? JSON.stringify(agentState.ragSourceDetails)
          : currentMessage?.ragSourceDetails

        // 更新占位消息，保留 RAG 相关字段
        await saveChat({
          id: placeholderMessage.id,
          tagId: placeholderMessage.tagId,
          conversationId: placeholderMessage.conversationId,
          role: placeholderMessage.role,
          type: placeholderMessage.type,
          inserted: placeholderMessage.inserted,
          createdAt: placeholderMessage.createdAt,
          ragSources: resolvedRagSources,
          ragSourceDetails: resolvedRagSourceDetails,
          // 设置新的内容
          content: finalContent,
          agentHistory: JSON.stringify(agentHistory),
        }, true)

        // 清空 Final Answer 模式状态
        setAgentState({
          activeChatId: undefined,
          isFinalAnswerMode: false,
          finalAnswerContent: undefined,
          traceEvents,
        })

        if (!effectivelyStopped) {
          startProactiveCompaction()
          const { scheduleConversationMemoryExtraction } = await import('@/lib/memory/auto-memory')
          scheduleConversationMemoryExtraction(placeholderMessage.conversationId)
        }

      },
      onError: async (error) => {
        const parsedOverflow = parseContextOverflowError(error)
        const inferredOverflow =
          !parsedOverflow.detected
          && contextCapacityProbeActive
          && isUnknownProviderError(error)
        const overflow = inferredOverflow
          ? { detected: true }
          : parsedOverflow
        if (inferredOverflow) {
          agentDebugLog('context_overflow_inferred_from_provider_error', {
            error,
            reason: 'unknown_provider_error_during_capacity_probe',
          })
        }
        if (overflow.detected) {
          const aiConfig = modelSnapshot.config
          if (aiConfig) {
            if (overflow.contextWindow) {
              await learnContextWindow(aiConfig, overflow.contextWindow)
            } else {
              await reduceLearnedContextWindow(aiConfig)
            }
          }
        }

        const currentState = useChatStore.getState()
        const canRecoverFromOverflow =
          overflow.detected
          && contextOverflowRetryRef.current === 0
          && currentState.agentState.toolCalls.length === 0
          && !currentState.isTemporaryConversation
          && Boolean(currentState.currentConversationId)
        if (canRecoverFromOverflow) {
          deferredOverflowError = error
          agentDebugLog('context_overflow_error_deferred', {
            conversationId: currentState.currentConversationId,
            contextWindow: overflow.contextWindow || null,
          })
          return
        }

        deferredOverflowError = undefined
        await persistAgentError(error)
      },
    })

    agentSession.setActiveRunner(agentHandler)

    try {
      // 构建上下文信息
      let context = ''

      // 1. 图片先由专用视觉模型识别，失败时回退 OCR。
      // 主聊天模型只接收结构化识别结果，不依赖自身的视觉能力。
      if (request.images.length > 0) {
        imageAnalysisAbortControllerRef.current?.abort()
        const imageAnalysisAbortController = new AbortController()
        imageAnalysisAbortControllerRef.current = imageAnalysisAbortController
        let liveAnalyses = createPendingChatImageAnalyses(request.images, request.requestText)
        const updatePersistedAnalysis = (analyses: PersistedChatImageAnalysis[], persist: boolean) => {
          const updatedMessage = {
            ...userMessage,
            imageAnalyses: serializeChatImageAnalyses(analyses),
          }
          if (persist) {
            return saveChat(updatedMessage, true)
          } else {
            useChatStore.getState().updateChat(updatedMessage)
          }
        }

        setAgentState({
          status: 'analyzing_images',
          isRunning: true,
          isThinking: false,
        })
        const imageResult = await buildChatImageContext(request.images, request.requestText, {
          signal: imageAnalysisAbortController.signal,
          onProgress: (progress) => {
            liveAnalyses = liveAnalyses.map(analysis => (
              analysis.imageId === progress.imageId
                ? {
                    ...analysis,
                    status: progress.status,
                    method: progress.method ?? analysis.method,
                    errorCode: progress.errorCode,
                    updatedAt: Date.now(),
                  }
                : analysis
            ))
            updatePersistedAnalysis(liveAnalyses, false)
          },
        })
        imageAnalysisAbortControllerRef.current = null
        await updatePersistedAnalysis(imageResult.analyses, true)
        agentImageAttachments.push(...imageResult.analyses.map(analysis => ({
          ...analysis,
          chatId: userMessage.id,
        })))
        if (imageResult.context) {
          context += `${imageResult.context}\n`
        }

        agentDebugLog('chat_context_images_analyzed', {
          imageCount: request.images.length,
          contextLength: imageResult.context.length,
          preview: previewText(imageResult.context),
        })
      }

      const historicalImageContext = buildHistoricalImageContext(
        useChatStore.getState().chats.filter(chat => chat.id !== userMessage.id)
      )
      if (historicalImageContext) {
        context += `${historicalImageContext}\n`
      }

      // 2. 当前编辑器内容由 AgentHandler 在模型调用前读取实时快照并注入系统提示词。
      // 这里不再重复追加 currentArticle，避免同一篇正文占用两份上下文。

      agentDebugLog('chat_context_active_note', {
        activeFilePath: activeArticle.activeFilePath || null,
        currentArticleLength: activeArticle.currentArticle.length,
        injected: false,
        injectedByRuntimeSnapshot: Boolean(activeArticle.activeFilePath),
        preview: previewText(activeArticle.currentArticle),
      })
      // 3. 关联文件夹作为 Agent 自动检索时的优先范围，不在发送前预先检索。
      if (request.linkedResource && isLinkedFolder(request.linkedResource)) {
        context += [
          '## 用户关联的笔记文件夹',
          `用户关联了文件夹“${request.linkedResource.name}”（${request.linkedResource.relativePath}）。`,
          '如果当前请求需要查找用户资料，请优先使用 knowledge_search，并将 folderPath 设置为这个相对路径。不要在没有必要时搜索。',
          '',
        ].join('\n')
      }

      // 4. 如果有关联文件（非文件夹），始终注入完整内容作为 Agent 上下文
      const linkedResourceIsActiveFile = request.linkedResource && !isLinkedFolder(request.linkedResource) && (
        request.linkedResource.relativePath === activeArticle.activeFilePath ||
        request.linkedResource.path === activeArticle.activeFilePath ||
        request.linkedResource.name === activeArticle.activeFilePath.split('/').pop()
      )

      if (request.linkedResource && !isLinkedFolder(request.linkedResource) && !linkedResourceIsActiveFile) {
        try {
          const workspace = await getWorkspacePath()
          let linkedFileContent = ''
          if (workspace.isCustom) {
            linkedFileContent = await readTextFile(request.linkedResource.path)
          } else {
            const { path, baseDir } = await getFilePathOptions(request.linkedResource.path)
            linkedFileContent = await readTextFile(path, { baseDir })
          }

          if (request.linkedResourcePreview) {
            context += `\n${request.linkedResourcePreview}\n`
          }

          if (linkedFileContent) {
            context += `\n## 关联文件完整内容\n\nThe full content of the linked file "${request.linkedResource.name}" (${request.linkedResource.relativePath}) is already included below. Do not call tools to read or check this same file again unless the user explicitly asks to refresh it.\n\n---\n${linkedFileContent}\n---\n`
          }

          agentDebugLog('chat_context_linked_file', {
            name: request.linkedResource.name,
            relativePath: request.linkedResource.relativePath,
            contentLength: linkedFileContent.length,
            hasPreview: Boolean(request.linkedResourcePreview),
          })
        } catch (error) {
          console.error('Failed to read linked file in Agent mode:', error)
        }
      } else if (linkedResourceIsActiveFile) {
        agentDebugLog('chat_context_linked_file_skipped', {
          reason: 'linked file is already the active editor file',
          name: request.linkedResource?.name,
          relativePath: request.linkedResource?.relativePath,
        })
      }

      // 5. 如果有引用内容，添加引用上下文（在构建消息之前）
      if (request.quoteData) {
        const { fileName, startLine, endLine, fullContent, from, to } = request.quoteData
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

如果用户是在提问、解释、总结、分析、询问译法、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

如果用户明确说“这句/这段/选中内容翻译成某种语言”，这是编辑请求，必须直接使用 editor_replace_range；已有 from/to 已足够，禁止再调用 editor_get_state 或 editor_get_selection。

**🚨 当且仅当用户明确要求修改时，必须精确替换用户选中的范围**: 当前引用内容来自编辑器选区，必须优先使用 editor_replace_range，只替换这段选中的内容：
- from: ${from}
- to: ${to}
- 使用 content 传入新内容
- 只允许替换这个选区，禁止扩大到整篇文档或整段之外

**如果用户说“在这段前面/后面/上面/下面插入、补充、添加”**:
- 仍然使用 editor_replace_range
- 基于当前引用范围整体替换
- 前插: 新内容 + 原引用内容
- 后插: 原引用内容 + 新内容
- 不要使用 editor_insert_at_cursor，因为聊天输入会让编辑器失焦，当前光标位置不可靠

**如果用户明确要求“前面和后面都增加内容”**:
- 仍然使用 editor_replace_range
- content 直接传入最终替换内容：前插内容 + 原引用内容 + 后插内容
- 不要使用额外协议标记；工具会把 content 原样写入选区

**兜底行号信息**:
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止改动选区之外的内容
- 禁止获取整个文档后再重写整篇
- 禁止把 startLine/endLine 擅自改成 1/1` : hasValidLineNumbers ? `**仅在用户明确要求修改/改写/补充/插入时才允许编辑**。

如果用户是在提问、解释、总结、分析、询问译法、润色建议、代码说明，应该直接基于这段引用内容回答，**不要调用任何编辑工具**。

如果用户明确说“这句/这段/选中内容翻译成某种语言”，这是编辑请求，必须直接使用 editor_replace_lines；已有行号已足够，禁止再调用 editor_get_state 或 editor_get_selection。

**🚨 当且仅当用户明确要求修改时，必须使用行号修改**: 当用户引用内容并要求修改时，你必须使用 editor_replace_lines，传入精确的行号：
- 单行修改: startLine: ${startLine}, endLine: ${endLine}
- 多行范围: startLine: ${startLine}, endLine: ${endLine}
- 必须使用 replaceContent 参数传入新内容

**禁止**:
- 禁止在解释/分析类请求中调用编辑工具
- 禁止使用 from/to 位置参数
- 禁止使用 searchContent 文本搜索模式
- 禁止获取整个文档内容后再操作` : `**注意**: 此引用内容只有选中文本，没有可安全使用的 Markdown 源码位置。

- 如果用户只是在提问、解释、总结或分析，请直接回答，不要调用编辑工具。
- 如果用户明确要求修改当前选区，只能调用 editor_insert_at_cursor，并设置 replaceSelection=true。
- 不要推测 from/to 或行号；如果活动选区已经变化，工具会安全失败。`}

请基于这段引用内容回答用户的问题。

`

        agentDebugLog('chat_context_quote', {
          fileName,
          startLine,
          endLine,
          from,
          to,
          quoteLength: request.quoteData.quote.length,
          contentLength: fullContent.length,
          quotePreview: previewText(request.quoteData.quote),
          fullContentPreview: previewText(fullContent),
          hasValidRange,
        })
      }

      context += buildCanvasSelectionContext(request.canvasSelectionContext)
      context += await buildMentionedContext({
        files: request.mentionedFiles,
        records: request.mentionedRecords,
        canvases: request.mentionedCanvases,
      })

      // 6. 构建消息数组：较早回合使用会话级锚定摘要，最近完整回合保留原文
      const compactionContext = [
        context,
        activeArticle.activeFilePath ? activeArticle.currentArticle : '',
      ].filter(Boolean).join('\n\n')
      const chatState = useChatStore.getState()
      const { chats } = chatState
      const {
        buildMessagesWithHistory,
        prepareConversationHistory,
      } = await import('@/lib/ai/condense')
      let preparedHistory: Awaited<ReturnType<typeof prepareConversationHistory>> | null = null
      if (!chatState.isTemporaryConversation && chatState.currentConversationId) {
        try {
          preparedHistory = await prepareConversationHistory({
            conversationId: chatState.currentConversationId,
            aiConfig: modelSnapshot.config,
            chats,
            currentUserInput: request.requestText,
            additionalContext: compactionContext,
            imageCount: 0,
          })
          pendingCapacityProbe = preparedHistory.capacityProbe
          contextCapacityProbeActive = Boolean(
            preparedHistory.capacityProbe
            || preparedHistory.capacityLimitProbe
          )
        } catch (error) {
          console.error('[ConversationCompaction] Failed to prepare history:', error)
        }
      }

      // 使用 buildMessagesWithHistory 构建完整的消息数组
      // 注意：Agent 模式下，不传入 systemPrompt（Agent 会自己构建）
      // 将所有上下文（文章、RAG、关联文件、引用）作为 additionalContext
      let messages = buildMessagesWithHistory(
        chats,
        undefined, // systemPrompt - Agent 会自己构建
        context,   // additionalContext - 包含文章、RAG、关联文件、引用等
        undefined, // currentUserInput - AgentRuntime 负责且只注入一次
        {
          // Agent 自己会在 think() 里重新注入当前请求，避免重复。
          // 保留 assistant 历史；已由会话级摘要覆盖的旧回合会在构建阶段排除。
          includeAssistantMessages: true,
          includeLatestUserMessage: false,
          conversationSummary: preparedHistory?.compaction?.summary,
          coveredThroughChatId: preparedHistory?.compaction?.coveredThroughChatId,
        }
      )

      agentDebugLog('chat_messages_built', {
        userInput: request.requestText,
        contextLength: context.length,
        compactionRevision: preparedHistory?.compaction?.revision || null,
        compactionSource: preparedHistory?.capacity.source || null,
        compactionWindow: preparedHistory?.capacity.contextWindow || null,
        messageCount: messages.length,
        messages: messages.map((message, index) => ({
          index,
          role: message.role,
          contentLength: message.content.length,
          preview: previewText(message.content),
        })),
      })

      try {
        await agentHandler.execute(request.requestText, messages)
      } catch (error) {
        const parsedOverflow = parseContextOverflowError(error)
        const overflow =
          !parsedOverflow.detected
          && contextCapacityProbeActive
          && isUnknownProviderError(error)
            ? { detected: true }
            : parsedOverflow
        const canRetry =
          overflow.detected
          && contextOverflowRetryRef.current === 0
          && useChatStore.getState().agentState.toolCalls.length === 0
          && !chatState.isTemporaryConversation
          && Boolean(chatState.currentConversationId)

        if (!canRetry || !chatState.currentConversationId) {
          throw error
        }

        contextOverflowRetryRef.current = 1
        const previousCompactionRevision = preparedHistory?.compaction?.revision
        preparedHistory = await prepareConversationHistory({
          conversationId: chatState.currentConversationId,
          aiConfig: modelSnapshot.config,
          chats: useChatStore.getState().chats,
          currentUserInput: request.requestText,
          additionalContext: compactionContext,
          imageCount: 0,
          force: true,
        })
        pendingCapacityProbe = preparedHistory.capacityProbe
        contextCapacityProbeActive = false
        if (
          !preparedHistory.compacted
          && preparedHistory.compaction?.revision === previousCompactionRevision
        ) {
          throw error
        }
        messages = buildMessagesWithHistory(
          useChatStore.getState().chats,
          undefined,
          context,
          undefined,
          {
            includeAssistantMessages: true,
            includeLatestUserMessage: false,
            conversationSummary: preparedHistory.compaction?.summary,
            coveredThroughChatId: preparedHistory.compaction?.coveredThroughChatId,
          }
        )
        await agentHandler.execute(request.requestText, messages)
      }
    } catch (error) {
      if (deferredOverflowError) {
        await persistAgentError(deferredOverflowError)
        deferredOverflowError = undefined
      }
      console.error('Agent execution error:', error)
    } finally {
      agentSession.setActiveRunner(null)
    }
  }

  const insertUserRequest = async (request: AgentRequestSnapshot) => {
    const imageUrls = request.images.map(image => image.url)
    return insert({
      tagId: currentTagId,
      role: 'user',
      content: request.inputValue,
      type: 'chat',
      inserted: false,
      images: imageUrls.length > 0 ? JSON.stringify(imageUrls) : undefined,
      imageAnalyses: request.images.length > 0
        ? serializeChatImageAnalyses(createPendingChatImageAnalyses(request.images, request.requestText))
        : undefined,
      attachments: request.fileAttachments.length > 0
        ? serializeChatAttachments(request.fileAttachments)
        : undefined,
      quoteData: request.quoteData ? JSON.stringify(request.quoteData) : undefined,
    })
  }

  const prepareSteering = async (
    request: AgentRequestSnapshot,
    sequence: number
  ): Promise<AgentSteeringPayload> => {
    let additionalContext = ''
    let steeringImageAttachments: PersistedChatImageAnalysis[] | undefined

    try {
      additionalContext = await buildAgentSteeringContext(request, isMobile)
    } catch (error) {
      console.error('Failed to build steering context:', error)
    }

    if (request.images.length > 0) {
      steeringImageAnalysisAbortControllerRef.current?.abort()
      const controller = new AbortController()
      steeringImageAnalysisAbortControllerRef.current = controller
      try {
        const imageResult = await buildChatImageContext(request.images, request.requestText, {
          signal: controller.signal,
        })
        additionalContext = [additionalContext, imageResult.context].filter(Boolean).join('\n\n')
        steeringImageAttachments = imageResult.analyses
      } finally {
        if (steeringImageAnalysisAbortControllerRef.current === controller) {
          steeringImageAnalysisAbortControllerRef.current = null
        }
      }
    }

    return {
      sequence,
      text: request.requestText,
      selectedSkills: request.selectedSkillIds,
      additionalContext,
      currentQuote: request.quoteData ? {
        fileName: request.quoteData.fileName,
        articlePath: request.quoteData.articlePath,
        startLine: request.quoteData.startLine,
        endLine: request.quoteData.endLine,
        from: request.quoteData.from,
        to: request.quoteData.to,
        fullContent: request.quoteData.fullContent,
        selectionToken: request.quoteData.selectionToken,
      } : undefined,
      attachments: request.fileAttachments,
      imageAttachments: steeringImageAttachments,
    }
  }

  agentSession.configure({
    execute: async (request) => {
      const modelId = useSettingStore.getState().primaryModel
      const aiConfig = applyChatReasoningOverride(
        await getAISettingsByModelId(modelId), modelId, request.reasoningOverride ?? null,
      )
      const modelSnapshot = {
        id: modelId,
        name: aiConfig?.model || modelId,
        config: aiConfig,
      }
      setAgentState({
        activeModelId: modelSnapshot.id,
        activeModelName: modelSnapshot.name,
      })
      const userMessage = await insertUserRequest(request)
      if (userMessage) {
        if (typeof userMessage.conversationId === 'number') {
          agentSessionManager.rekey(
            agentSessionId,
            `conversation:${userMessage.conversationId}`
          )
        }
        await handleAgentMode(request, userMessage, modelSnapshot)
      }
    },
    prepareSteering,
    onSteeringError: error => console.error('Failed to prepare steering message:', error),
  })

  // 对话（Agent 模式）
  async function handleSubmit(overrideText?: string) {
    const request = createRequestSnapshot(overrideText)
    if (!request.inputValue.trim() && request.images.length === 0 && request.fileAttachments.length === 0) return
    const wasStreaming = agentSession.isStreaming
    if (!wasStreaming) {
      manualStopRequestedRef.current = false
      contextOverflowRetryRef.current = 0
      repeatedScriptApprovalRef.current = { signature: '', count: 0 }
      setLoading(true)
    }
    onSent?.()

    try {
      await agentSession.prompt(request, {
        streamingBehavior: wasStreaming ? 'followUp' : undefined,
      })
    } finally {
      if (!wasStreaming) {
        setLoading(false)
      }
    }
  }

  const handleStop = async () => {
    manualStopRequestedRef.current = true
    imageAnalysisAbortControllerRef.current?.abort()
    imageAnalysisAbortControllerRef.current = null
    steeringImageAnalysisAbortControllerRef.current?.abort()
    steeringImageAnalysisAbortControllerRef.current = null

    // 停止普通对话的流式输出
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    agentSession.abort()

    // 重置 loading 状态
    setLoading(false)
  }

  const hasInput = Boolean(inputValue.trim() || attachedImages.length > 0 || fileAttachments.length > 0)
  const showStop = loading && !hasInput

  return (
    <span className="relative inline-flex">
      <TooltipButton
        variant={dockStyle ? "ghost" : showStop ? "destructive" : "default"}
        size={dockStyle ? "icon" : "sm"}
        icon={showStop ? <Square className="fill-current" /> : <Send />}
        disabled={!showStop && (!primaryModel || !hasInput)}
        tooltipText={showStop
          ? t('record.chat.input.stop')
          : loading
            ? t('record.chat.input.agent.deliveryMode.pending.add')
            : t('record.chat.input.send')}
        onClick={showStop ? handleStop : () => void handleSubmit()}
        buttonClassName={dockStyle ? cn(
          "size-8 rounded-full border border-border/50 bg-[hsl(var(--component-active-bg))] text-foreground shadow-none hover:bg-[hsl(var(--component-active-bg))] hover:text-foreground",
          showStop && "border-destructive bg-background text-destructive hover:bg-background hover:text-destructive"
        ) : undefined}
      />
    </span>
  )
})

ChatSend.displayName = 'ChatSend';
