import OpenAI from 'openai'
import { AgentRuntime, isRequestAbortError } from './runtime'
import type { AgentApprovalDecision, AgentChange, AgentPermissionMode, AgentQuoteSnapshot, AgentRuntimeResult, AgentSteeringPayload, AgentStep, AgentTraceEvent, ToolCall } from './types'
import type { RuntimeChatAttachment } from '@/lib/chat-attachments'
import type { AgentImageAttachment } from '@/lib/chat-image-context'
import { retainCompletedAgentTraceEvents } from './trace-retention'
import type { AgentStateAdapter } from './agent-state-adapter'
import type { AgentResourceAdapter } from './agent-resource-adapter'
import type { AiConfig } from '@/app/core/setting/config'

export interface AgentHandlerConfig {
  requestUserQuestion?: import('./types').AgentToolExecutionContext['requestUserQuestion']
  stateAdapter: AgentStateAdapter
  resourceAdapter: AgentResourceAdapter
  activeChatId?: number
  modelId?: string
  modelName?: string
  aiConfig?: AiConfig
  activeFilePath?: string
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
    context?: {
      previewParams?: Record<string, any>
      originalContent?: string
      modifiedContent?: string
      filePath?: string
      from?: number
      to?: number
    }
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
  private retrievedKnowledgeSources = new Map<string, {
    filepath: string
    filename: string
    content: string
    sourceKey: string
    sourceType: 'article' | 'record' | 'canvas'
    sourceId: string
    locator?: {
      filePath?: string
      markId?: number
      tagId?: number
      canvasId?: string
      nodeIds?: string[]
    }
    updatedAt?: number
  }>()

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
        onFinalAnswerRender: (content) => {
          stateAdapter.setState({
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
    this.config.stateAdapter.setState({ pendingQuestion: undefined })
    const state = this.config.stateAdapter.getState()
    const pending = state.pendingConfirmation
    if (pending) {
      this.config.stateAdapter.setState({
        pendingConfirmation: undefined,
        confirmationHistory: [
          ...state.confirmationHistory,
          {
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

    this.config.stateAdapter.setState({ pendingQuestion: undefined })

    const state = this.config.stateAdapter.getState()
    const pending = state.pendingConfirmation
    if (pending) {
      this.config.stateAdapter.setState({
        pendingConfirmation: undefined,
        confirmationHistory: [
          ...state.confirmationHistory,
          {
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
    this.config.stateAdapter.setState({
      runId: event.runId,
      traceEvents: [
        ...(current.traceEvents || []).filter((item) => item.id !== event.id),
        event,
      ],
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
    if (toolCall.toolName === 'knowledge_cite_sources' && toolCall.status === 'success') {
      this.captureCitedKnowledgeSources(toolCall)
    }
  }

  private captureKnowledgeSearchCandidates(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!Array.isArray(data)) return
    for (const value of data) {
      if (!value || typeof value !== 'object') continue
      const candidate = value as {
        sourceKey?: unknown
        sourceType?: unknown
        sourceId?: unknown
        title?: unknown
        fragments?: unknown
        locator?: unknown
        updatedAt?: unknown
      }
      if (
        typeof candidate.sourceKey !== 'string'
        || (candidate.sourceType !== 'article' && candidate.sourceType !== 'record' && candidate.sourceType !== 'canvas')
      ) continue
      const locator = candidate.locator && typeof candidate.locator === 'object'
        ? candidate.locator as {
            filePath?: string
            markId?: number
            tagId?: number
            canvasId?: string
            nodeIds?: string[]
          }
        : undefined
      const fragments = Array.isArray(candidate.fragments)
        ? candidate.fragments.flatMap(fragment => (
            fragment && typeof fragment === 'object' && typeof (fragment as { content?: unknown }).content === 'string'
              ? [(fragment as { content: string }).content]
              : []
          ))
        : []
      const title = typeof candidate.title === 'string' ? candidate.title : candidate.sourceKey
      this.retrievedKnowledgeSources.set(candidate.sourceKey, {
        sourceKey: candidate.sourceKey,
        sourceType: candidate.sourceType,
        sourceId: typeof candidate.sourceId === 'string' ? candidate.sourceId : candidate.sourceKey,
        filepath: locator?.filePath || candidate.sourceKey,
        filename: title,
        content: fragments.join('\n\n'),
        locator,
        updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : undefined,
      })
    }
  }

  private captureKnowledgeReadPages(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!Array.isArray(data)) return
    for (const value of data) {
      if (!value || typeof value !== 'object') continue
      const page = value as { sourceKey?: unknown; content?: unknown }
      if (typeof page.sourceKey !== 'string' || typeof page.content !== 'string') continue
      const current = this.retrievedKnowledgeSources.get(page.sourceKey)
      if (!current) continue
      this.retrievedKnowledgeSources.set(page.sourceKey, {
        ...current,
        content: current.content.includes(page.content)
          ? current.content
          : [current.content, page.content].filter(Boolean).join('\n\n'),
      })
    }
  }

  private captureCitedKnowledgeSources(toolCall: ToolCall) {
    const data = toolCall.result?.data
    if (!data || typeof data !== 'object') return
    const sourceKeys = (data as { sourceKeys?: unknown }).sourceKeys
    if (!Array.isArray(sourceKeys)) return
    const ragSourceDetails = sourceKeys.flatMap(sourceKey => (
      typeof sourceKey === 'string' && this.retrievedKnowledgeSources.has(sourceKey)
        ? [this.retrievedKnowledgeSources.get(sourceKey)!]
        : []
    ))
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
