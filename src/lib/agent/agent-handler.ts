import OpenAI from 'openai'
import { isKnowledgeSourceType, type KnowledgeLocator, type RagSourceDetail } from '@/types/knowledge'
import { AgentRuntime, isRequestAbortError } from './runtime'
import type { AgentApprovalDecision, AgentEditPreview, AgentChange, AgentPermissionMode, AgentQuoteSnapshot, AgentRuntimeResult, AgentSteeringPayload, AgentStep, AgentTraceEvent, ToolCall } from './types'
import type { RuntimeChatAttachment } from '@/lib/chat-attachments'
import type { AgentImageAttachment } from '@/lib/chat-image-context'
import { retainCompletedAgentTraceEvents } from './trace-retention'
import type { AgentStateAdapter } from './agent-state-adapter'
import type { AgentResourceAdapter } from './agent-resource-adapter'
import type { AiConfig } from '@/app/core/setting/config'
import { cancelActiveChatUiInteractions } from '@/lib/chat-ui/interaction'

export interface AgentHandlerConfig {
  requestUserQuestion?: import('./types').AgentToolExecutionContext['requestUserQuestion']
  requestUserInteraction?: import('./types').AgentToolExecutionContext['requestUserInteraction']
  stateAdapter: AgentStateAdapter
  resourceAdapter: AgentResourceAdapter
  activeChatId?: number
  modelId?: string
  modelName?: string
  aiConfig?: AiConfig
  activeFilePath?: string
  activeEditorOnly?: boolean
  activeCanvasId?: string
  permissionMode?: AgentPermissionMode
  conversationId?: number
  workspaceId?: string
  useMemories?: boolean
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onComplete?: (result: string, steps?: AgentStep[], stopped?: boolean) => void
  onError?: (error: string) => void
  onSteeringDelivered?: (sequences: number[]) => void
  onFinalAnswerRender?: (markdownContent: string) => void
  formatAutoFinalAnswer?: (key: string, values?: Record<string, string>) => string
  requestConfirmation?: (
    toolName: string,
    params: Record<string, any>,
    context?: AgentEditPreview
  ) => Promise<AgentApprovalDecision>
  currentQuote?: AgentQuoteSnapshot
  attachments?: RuntimeChatAttachment[]
  imageAttachments?: AgentImageAttachment[]
  selectedSkills?: string[]
}

export class AgentHandler {
  private runtime: AgentRuntime | null = null
  private stopped = false
  private readonly config: AgentHandlerConfig
  private acceptingSteering = true
  private pendingSteering: AgentSteeringPayload[] = []
  private retrievedKnowledgeSources = new Map<string, RagSourceDetail>()

  constructor(config: AgentHandlerConfig) {
    this.config = config
  }

  async execute(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[]
  ): Promise<string> {
    const stateAdapter = this.config.stateAdapter
    this.acceptingSteering = true
    this.retrievedKnowledgeSources.clear()

    stateAdapter.reset()
    stateAdapter.setState({
      activeChatId: this.config.activeChatId,
      activeModelId: this.config.modelId,
      activeModelName: this.config.modelName,
      isRunning: true,
      isThinking: false,
      status: 'preparing_context',
      selectedSkills: this.config.selectedSkills,
      currentStepStartTime: Date.now(),
    })

    this.runtime = new AgentRuntime()
    for (const payload of this.pendingSteering.splice(0)) {
      this.runtime.steer(payload)
    }

    await this.config.resourceAdapter.initializeMcp()
    const selectedMcpServerIds = this.config.resourceAdapter.getSelectedMcpServerIds()
    const skillsInfo = await this.config.resourceAdapter.getSkillsInfo(this.config.selectedSkills || [])
    const currentEditorState = await this.config.resourceAdapter.getCurrentEditorState(
      this.config.activeFilePath
    )

    if (this.stopped) {
      this.acceptingSteering = false
      stateAdapter.setState({
        isRunning: false,
        isThinking: false,
        status: 'stopped',
      })
      this.config.onComplete?.('', [], true)
      return ''
    }

    const messages = Array.isArray(contextOrMessages)
      ? contextOrMessages
      : contextOrMessages
        ? [{ role: 'system' as const, content: contextOrMessages }]
        : []

    try {
      const result = await this.runtime.run({
        userInput,
        aiConfig: this.config.aiConfig,
        messages,
        imageUrls,
        activeChatId: this.config.activeChatId,
        activeFilePath: this.config.activeFilePath,
        activeEditorOnly: this.config.activeEditorOnly,
        activeCanvasId: this.config.activeCanvasId,
        currentEditorState,
        currentQuote: this.config.currentQuote,
        availableSkills: skillsInfo,
        selectedSkills: this.config.selectedSkills,
        selectedMcpServerIds,
        attachments: this.config.attachments,
        imageAttachments: this.config.imageAttachments,
        permissionMode: this.config.permissionMode,
        conversationId: this.config.conversationId,
        workspaceId: this.config.workspaceId,
        useMemories: this.config.useMemories,
      }, {
        onStatus: (status) => {
          stateAdapter.setState({
            status,
            ...(['completed', 'failed', 'stopped'].includes(status) ? { responsePreview: undefined } : {}),
            isRunning: status !== 'completed' && status !== 'failed' && status !== 'stopped',
            isThinking: status === 'thinking',
            currentStepStartTime: status === 'thinking' || status === 'calling_tool'
              ? Date.now()
              : stateAdapter.getState().currentStepStartTime,
          })
        },
        onSteeringDelivered: (payloads) => {
          this.config.onSteeringDelivered?.(payloads.map(payload => payload.sequence))
        },
        onTrace: (event) => {
          this.appendTrace(event)
        },
        onToolCall: (toolCall) => {
          this.upsertToolCall(toolCall)
        },
        onChange: (change) => {
          this.appendChange(change)
        },
        onStep: (step) => {
          this.appendStep(step)
          if (step.action) {
            this.config.onAction?.(step.action.tool, step.action.params)
          }
          if (step.observation) {
            this.config.onObservation?.(step.observation)
          }
        },
        onCandidateAnswerRender: (content) => {
          stateAdapter.setState({
            activeChatId: this.config.activeChatId,
            isFinalAnswerMode: true,
            finalAnswerContent: content,
          })
        },
        onCandidateAnswerClear: () => {
          stateAdapter.setState({
            isFinalAnswerMode: false,
            finalAnswerContent: undefined,
          })
        },
        onResponsePreview: (preview, previewRunId) => {
          const state = stateAdapter.getState()
          if (state.runId !== previewRunId || state.activeChatId !== this.config.activeChatId) return
          if (!preview) { stateAdapter.setState({ responsePreview: undefined }); return }
          if (this.stopped || !state.isRunning || state.runId !== preview.runId) return
          stateAdapter.setState({ responsePreview: preview })
        },
        onFinalAnswerRender: (content) => {
          stateAdapter.setState({
            responsePreview: undefined,
            activeChatId: this.config.activeChatId,
            isFinalAnswerMode: true,
            finalAnswerContent: content,
          })
          this.config.onFinalAnswerRender?.(content)
        },
        requestConfirmation: async (toolName, params, context) => {
          return await this.config.requestConfirmation?.(toolName, params, context) || 'denied'
        },
        requestUserQuestion: this.config.requestUserQuestion,
        requestUserInteraction: this.config.requestUserInteraction,
      })

      this.acceptingSteering = false
      this.finishRun(result)
      this.config.onComplete?.(result.content, result.steps, result.stopped)
      return result.content
    } catch (error) {
      this.acceptingSteering = false
      if (this.stopped || isRequestAbortError(error)) {
        const agentState = stateAdapter.getState()
        const latestModelOutput = [...(agentState.traceEvents || [])]
          .reverse()
          .find(event => (
            event.type === 'model_response' || event.type === 'model_call'
          ) && typeof event.output === 'string')
          ?.output
        const partialContent = agentState.finalAnswerContent
          || (typeof latestModelOutput === 'string' ? latestModelOutput : '')
        stateAdapter.setState({
          isRunning: false,
          isThinking: false,
          status: 'stopped',
        })
        this.config.onComplete?.(partialContent, agentState.completedSteps, true)
        return partialContent
      }

      stateAdapter.setState({
        isRunning: false,
        isThinking: false,
        status: 'failed',
      })
      const errorMessage = error instanceof Error ? error.message : String(error)
      await this.config.onError?.(errorMessage)
      throw error
    }
  }

  stop() {
    this.stopped = true
    cancelActiveChatUiInteractions()
    this.config.stateAdapter.setState({ pendingQuestion: undefined, pendingUiInteraction: undefined, responsePreview: undefined })
    const state = this.config.stateAdapter.getState()
    const pending = state.pendingConfirmation
    if (pending) {
      this.config.stateAdapter.setState({
        pendingConfirmation: undefined,
        confirmationHistory: [
          ...state.confirmationHistory,
          {
            id: pending.id,
            runId: pending.runId,
            chatId: pending.chatId,
            conversationId: pending.conversationId,
            traceEventId: pending.traceEventId,
            workspacePath: pending.workspacePath,
            toolName: pending.toolName,
            params: pending.params,
            status: 'cancelled',
            timestamp: Date.now(),
          },
        ],
      })
    }
    this.runtime?.stop()
  }

  steer(payload: AgentSteeringPayload) {
    if (!this.acceptingSteering) {
      return false
    }

    cancelActiveChatUiInteractions()
    this.config.stateAdapter.setState({ pendingQuestion: undefined, pendingUiInteraction: undefined, responsePreview: undefined })

    const state = this.config.stateAdapter.getState()
    const pending = state.pendingConfirmation
    if (pending) {
      this.config.stateAdapter.setState({
        pendingConfirmation: undefined,
        confirmationHistory: [
          ...state.confirmationHistory,
          {
            id: pending.id,
            runId: pending.runId,
            chatId: pending.chatId,
            conversationId: pending.conversationId,
            traceEventId: pending.traceEventId,
            workspacePath: pending.workspacePath,
            toolName: pending.toolName,
            params: pending.params,
            status: 'superseded',
            timestamp: Date.now(),
          },
        ],
        status: 'steering',
        isRunning: true,
      })
    }

    if (this.runtime) {
      this.runtime.steer(payload)
    } else {
      this.pendingSteering.push(payload)
    }
    return true
  }

  clearSteeringQueue() {
    this.pendingSteering = []
    this.runtime?.clearSteeringQueue()
  }

  removeSteering(sequence: number) {
    this.pendingSteering = this.pendingSteering.filter(payload => payload.sequence !== sequence)
    this.runtime?.removeSteering(sequence)
  }

  private appendTrace(event: AgentTraceEvent) {
    const current = this.config.stateAdapter.getState()
    const traceEvents = current.traceEvents || []
    const exists = traceEvents.some(item => item.id === event.id)
    this.config.stateAdapter.setState({
      runId: event.runId,
      // Completing an item must not move it past items that started after it.
      traceEvents: exists
        ? traceEvents.map(item => item.id === event.id ? { ...event } : item)
        : [...traceEvents, { ...event }],
      currentThought: event.message || event.title,
    })
    this.config.onThought?.(event.message || event.title)
  }

  private upsertToolCall(toolCall: ToolCall) {
    this.config.stateAdapter.upsertToolCall(toolCall)
    this.config.stateAdapter.setState({
      currentAction: `${toolCall.toolName}(${JSON.stringify(toolCall.params)})`,
    })

    if (toolCall.toolName === 'skill_load' && toolCall.status === 'success') {
      this.appendLoadedSkill(toolCall.params.skill_id)
    }

    if (toolCall.toolName === 'knowledge_search' && toolCall.status === 'success') {
      this.captureKnowledgeSearchCandidates(toolCall)
    }
    if (toolCall.toolName === 'knowledge_read_sources' && toolCall.status === 'success') {
      this.captureKnowledgeReadPages(toolCall)
    }
    if (toolCall.toolName === 'knowledge_read_wiki' && toolCall.status === 'success') {
      this.captureWikiReadPages(toolCall)
    }
    if (toolCall.toolName === 'knowledge_cite_sources' && toolCall.status === 'success') {
      this.captureCitedKnowledgeSources(toolCall)
    }
  }

  private rememberKnowledgeSource(value: Record<string, unknown>): RagSourceDetail | undefined {
    const { sourceKey, sourceType, title } = value
    if (typeof sourceKey !== 'string' || !isKnowledgeSourceType(sourceType)) return
    const locator = value.locator && typeof value.locator === 'object' ? value.locator as KnowledgeLocator : undefined
    const saved = this.retrievedKnowledgeSources.get(sourceKey)
    const stableId = typeof value.stableId === 'string' ? value.stableId : undefined
    const current = stableId && saved?.stableId && saved.stableId !== stableId ? undefined : saved
    const source: RagSourceDetail = {
      ...current, sourceKey, sourceType, stableId: stableId ?? current?.stableId, sourceId: sourceKey.slice(sourceKey.indexOf(':') + 1),
      filename: typeof title === 'string' ? title : current?.filename ?? sourceKey,
      filepath: locator?.filePath ?? current?.filepath ?? sourceKey,
      locator: locator ?? current?.locator,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : current?.updatedAt,
      content: current?.content ?? '',
    }
    this.retrievedKnowledgeSources.set(sourceKey, source)
    return source
  }

  private captureKnowledgeSearchCandidates(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!Array.isArray(data)) return
    for (const candidate of data) {
      if (!candidate || typeof candidate.sourceKey !== 'string' || this.retrievedKnowledgeSources.has(candidate.sourceKey)) continue
      this.rememberKnowledgeSource(candidate)
    }
  }

  private captureKnowledgeReadPages(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!Array.isArray(data)) return
    for (const page of data) {
      if (!page || typeof page !== 'object' || typeof page.content !== 'string') continue
      const source = this.rememberKnowledgeSource(page)
      if (!source) continue
      source.evidenceKind = 'source'
      if (typeof page.contentHash === 'string' && source.originalContentHash !== page.contentHash) {
        source.originalContentHash = page.contentHash
        source.content = ''
      }
      if (!source.content.includes(page.content)) source.content = [source.content, page.content].filter(Boolean).join('\n\n')
    }
  }

  private captureWikiReadPages(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!Array.isArray(data)) return
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const page = item as { pageId?: unknown; pageVersion?: unknown; viewHash?: unknown; content?: unknown; sourceRefs?: unknown; title?: unknown; updatedAt?: unknown }
      if (typeof page.pageId !== 'string' || typeof page.content !== 'string' || !Array.isArray(page.sourceRefs)) continue
      const { content, pageId } = page
      for (const reference of page.sourceRefs) {
        if (!reference || typeof reference !== 'object') continue
        const source = this.rememberKnowledgeSource(reference)
        if (!source) continue
        // The ranges are relative to this returned chunk. Unnumbered pages carry page-level provenance.
        const excerpt = Array.isArray(reference.ranges) ? reference.ranges.flatMap((range: unknown) => {
          if (!Array.isArray(range) || !Number.isInteger(range[0]) || !Number.isInteger(range[1])) return []
          return [content.slice(range[0], range[1]).trim()]
        }).filter(Boolean).join('\n\n') : content
        if (!excerpt) continue
        const pages = source.wikiEvidence ?? []
        const existing = pages.find(entry => entry.pageId === pageId && entry.viewHash === page.viewHash)
        if (existing) {
          if (!existing.content.includes(excerpt)) source.wikiEvidence = pages.map(entry => entry === existing
            ? { ...entry, content: `${entry.content}\n\n${excerpt}` } : entry)
        } else {
          source.wikiEvidence = [...pages, { pageId, viewHash: typeof page.viewHash === 'string' ? page.viewHash : undefined,
            title: typeof page.title === 'string' ? page.title : pageId,
            pageVersion: typeof page.pageVersion === 'string' ? page.pageVersion : undefined,
            updatedAt: typeof page.updatedAt === 'number' ? page.updatedAt : undefined, content: excerpt }]
        }
      }
    }
  }

  private captureCitedKnowledgeSources(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!data || typeof data !== 'object') return
    const { sourceKeys, originals: originalKeys, wikiEvidence: citedWikiPages } = data as {
      sourceKeys?: unknown
      originals?: unknown
      wikiEvidence?: Array<{ sourceKey: string; pageId: string; viewHash: string }>
    }
    if (!Array.isArray(sourceKeys)) return
    const originals = Array.isArray(originalKeys) ? new Set(originalKeys) : undefined
    const wikiEvidence = Array.isArray(citedWikiPages) ? citedWikiPages : undefined
    const ragSourceDetails = sourceKeys.flatMap(key => {
      const detail = this.retrievedKnowledgeSources.get(key)
      if (!detail) return []
      if (!originals || !wikiEvidence) return [detail]
      return [{ ...detail, content: originals.has(key) ? detail.content : '',
        evidenceKind: originals.has(key) ? detail.evidenceKind : undefined,
        wikiEvidence: detail.wikiEvidence?.filter(page => wikiEvidence.some(read =>
          read?.sourceKey === key && read.pageId === page.pageId && read.viewHash === page.viewHash)) }]
    })
    this.config.stateAdapter.setState({
      ragSources: ragSourceDetails.map(detail => detail.filename),
      ragSourceDetails,
    })
  }

  private appendLoadedSkill(skillId: unknown) {
    if (typeof skillId !== 'string' || !skillId) {
      return
    }

    const skill = this.config.resourceAdapter.getSkillSummary(skillId)
    const current = this.config.stateAdapter.getState().loadedSkills || []
    if (current.some((item) => item.id === skillId)) {
      return
    }

    this.config.stateAdapter.setState({
      loadedSkills: [
        ...current,
        {
          id: skillId,
          name: skill?.name || skillId,
          description: skill?.description,
        },
      ],
    })
  }

  private appendStep(step: AgentStep) {
    const current = this.config.stateAdapter.getState()
    this.config.stateAdapter.setState({
      completedSteps: [...current.completedSteps, step],
      currentObservation: step.observation,
      currentThought: step.thought,
    })
  }

  private appendChange(change: AgentChange) {
    const current = this.config.stateAdapter.getState()
    this.config.stateAdapter.setState({
      changes: [
        ...(current.changes || []).filter((item) => item.id !== change.id),
        change,
      ],
    })
  }

  private finishRun(result: AgentRuntimeResult) {
    this.config.stateAdapter.setState({
      responsePreview: undefined,
      runId: result.runId,
      isRunning: false,
      isThinking: false,
      status: result.stopped ? 'stopped' : 'completed',
      completedSteps: result.steps,
      toolCalls: result.toolCalls,
      changes: result.changes,
      traceEvents: retainCompletedAgentTraceEvents(result.trace),
      currentAction: undefined,
      currentObservation: undefined,
    })
  }
}
