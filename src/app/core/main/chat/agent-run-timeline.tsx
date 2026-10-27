"use client"

import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  Sparkles,
  Wrench,
} from "lucide-react"
import type { AgentRunStatus, AgentSkillSummary, AgentTraceEvent, ToolCall } from "@/lib/agent/types"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { AgentContextTray, type RagSourceDetail } from "./agent-context-tray"
import {
  agentStatusText,
  formatAgentDuration,
  formatAgentToolActivity,
  formatAgentToolName,
} from "./agent-display-utils"
import { estimateTokens } from "@/lib/ai/token-counter"
import ChatPreview from "./chat-preview"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import emitter from "@/lib/emitter"
import useChatStore from "@/stores/chat"
import type { Chat } from "@/db/chats"
import { Badge } from "@/components/ui/badge"
import { ChatUiMessages } from "@/components/chat-ui/chat-ui-messages"
import { parseChatUiBlocks } from "@/lib/chat-ui/serialization"
import { associateChatUiBlocks } from "@/lib/chat-ui/timeline"
import { AgentApprovalPanel } from "./agent-approval-panel"
import { cancelPendingAgentAction, confirmPendingAgentAction } from "./agent-approval-actions"
import { AgentQuestionPanel, AgentQuestionResult } from "./agent-question-panel"

interface AgentRunTimelineProps {
  chat?: Chat
  modelName?: string
  status?: AgentRunStatus
  isRunning?: boolean
  traceEvents?: AgentTraceEvent[]
  toolCalls?: ToolCall[]
  ragSources?: string[]
  ragSourceDetails?: RagSourceDetail[]
  loadedSkills?: AgentSkillSummary[]
}

function eventIcon(event: AgentTraceEvent) {
  if (event.status === "error") {
    return <AlertTriangle />
  }

  if (event.status === "running") {
    return <Loader2 className="animate-spin text-primary" />
  }

  if (event.type === "tool_call" || event.type === "tool_result") {
    return <Wrench />
  }

  if (event.type === "final") {
    return <CheckCircle2 />
  }

  return <Sparkles className="text-primary" />
}

function shouldShowEventMessage(event: AgentTraceEvent) {
  return event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "steering" ||
    event.type === "error"
}

function hasMeaningfulTraceDetail(value: unknown) {
  if (typeof value === "string") {
    return value.trim().length > 0
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (value && typeof value === "object") {
    return Object.keys(value).length > 0
  }

  return value !== undefined && value !== null
}

function shouldShowTraceEvent(event: AgentTraceEvent) {
  if (event.type === "model_call" || event.type === "model_response") {
    return event.status === "running" || Boolean(
      event.isIntermediateResponse &&
      typeof event.output === "string" &&
      event.output.trim()
    )
  }

  if (event.type === "final") {
    return false
  }

  if (event.type === "change") {
    return false
  }

  if (event.toolName === 'show_result' || event.toolName === 'render_response') return event.status === 'error'

  return true
}

function filterTimelineEvents(events: AgentTraceEvent[]) {
  return events.filter(shouldShowTraceEvent)
}

function getModelResponseContent(event: AgentTraceEvent) {
  if (
    (event.type === "model_call" || event.type === "model_response") &&
    typeof event.output === "string" &&
    event.output.trim()
  ) {
    return event.output
  }

  return undefined
}

function hasRecordedQuestionAnswers(event: AgentTraceEvent) {
  const result = event.output
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false
  const record = result as Record<string, unknown>
  if (record.ok !== true && record.success !== true) return false
  const data = record.data
  return Boolean(data && typeof data === 'object' && !Array.isArray(data)
    && Array.isArray((data as Record<string, unknown>).answers)
    && ((data as Record<string, unknown>).answers as unknown[]).length > 0)
}

function getModelReasoningContent(event: AgentTraceEvent) {
  const reasoning = event.reasoning?.trim()
  if (!reasoning) {
    return undefined
  }

  if (event.status === "running" && reasoning.length > 1200) {
    return `…${reasoning.slice(-1200)}`
  }

  return reasoning
}

function getReceivedTokenCount(event: AgentTraceEvent) {
  if (event.streamedTokenCount !== undefined) {
    return event.streamedTokenCount
  }

  const output = typeof event.output === "string"
    ? event.output
    : event.output
      ? JSON.stringify(event.output)
      : ""
  return estimateTokens(`${event.reasoning || ""}${output}`)
}

function formatProcessedDuration(duration?: number) {
  if (duration === undefined) return ""
  if (duration < 1000) return `${duration}ms`

  const totalSeconds = Math.round(duration / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`
  }

  return `${seconds}s`
}

function formatTraceDetail(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function compactTraceInput(event: AgentTraceEvent) {
  const value = event.input

  if (
    (event.toolName === "attachment_list" || event.toolName === "attachment_read") &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const visibleInput = { ...value as Record<string, unknown> }
    delete visibleInput.attachmentId
    return hasMeaningfulTraceDetail(visibleInput) ? visibleInput : undefined
  }

  return hasMeaningfulTraceDetail(value) ? value : undefined
}

function compactTraceOutput(event: AgentTraceEvent, visibleMessage?: string) {
  const value = event.output

  if (!hasMeaningfulTraceDetail(value)) {
    return undefined
  }

  if (event.type === "model_call" || event.type === "model_response") {
    return undefined
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return visibleMessage ? undefined : value
  }

  const output = value as {
    ok?: unknown
    success?: unknown
    message?: unknown
    data?: unknown
    error?: unknown
  }

  if (
    "ok" in output ||
    "success" in output ||
    "message" in output ||
    "data" in output ||
    "error" in output
  ) {
    if (event.status !== "error") {
      return visibleMessage ? undefined : output.data
    }

    const compacted: Record<string, unknown> = {}

    if (output.ok !== undefined) compacted.ok = output.ok
    if (output.success !== undefined) compacted.success = output.success
    if (!visibleMessage && output.message !== undefined) compacted.message = output.message
    if (output.error !== undefined) compacted.error = output.error
    if (output.data !== undefined) compacted.data = output.data

    return hasMeaningfulTraceDetail(compacted) ? compacted : undefined
  }

  return visibleMessage ? undefined : value
}

function traceDetailClassName(event: AgentTraceEvent) {
  const maxHeight = event.type === "model_call" || event.type === "model_response"
    ? "max-h-96"
    : "max-h-72"

  return `${maxHeight} overflow-auto rounded bg-muted/60 p-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]`
}

function statusIcon(status: AgentRunStatus, isRunning: boolean) {
  if (isRunning) {
    return <Loader2 className="animate-spin text-primary" />
  }

  if (status === "failed") {
    return <AlertTriangle />
  }

  return <CheckCircle2 />
}

function eventFromToolCall(toolCall: ToolCall): AgentTraceEvent {
  return {
    id: toolCall.id,
    runId: "live",
    type: "tool_call",
    title: formatAgentToolName(toolCall.toolName),
    status: toolCall.status === "running"
      ? "running"
      : toolCall.status === "error"
        ? "error"
        : toolCall.status === "success"
          ? "success"
          : "pending",
    timestamp: toolCall.timestamp,
    toolName: toolCall.toolName,
    input: toolCall.params,
    output: toolCall.result,
    message: toolCall.result?.message || toolCall.result?.error,
  }
}

export function AgentRunTimeline({
  chat,
  modelName,
  status = "idle",
  isRunning = false,
  traceEvents = [],
  toolCalls = [],
  ragSources = [],
  ragSourceDetails = [],
  loadedSkills = [],
}: AgentRunTimelineProps) {
  const t = useTranslations('record.chat')
  const chatLoading = useChatStore(state => state.loading)
  const pendingUiId = useChatStore(state => state.agentState.pendingUiInteraction?.id)
  const pendingApproval = useChatStore(state => state.agentState.pendingConfirmation)
  const pendingQuestion = useChatStore(state => state.agentState.pendingQuestion)
  const activeChatId = useChatStore(state => state.agentState.activeChatId)
  const [expandedEvents, setExpandedEvents] = React.useState<Record<string, boolean>>({})
  const [processOpen, setProcessOpen] = React.useState(false)

  const events = React.useMemo(() => {
    if (traceEvents.length > 0) {
      return filterTimelineEvents(traceEvents)
    }

    return toolCalls.map(eventFromToolCall)
  }, [traceEvents, toolCalls])
  const allUiBlocks = React.useMemo(() => parseChatUiBlocks(chat?.uiBlocks), [chat?.uiBlocks])
  const uiBlocks = React.useMemo(() => allUiBlocks.filter(block => block.placement === undefined || block.placement === 'step'), [allUiBlocks])
  const hasUnreadableUi = Boolean(chat?.uiBlocks && chat.uiBlocks.trim() !== '[]' && allUiBlocks.length === 0)
  const uiByEvent = React.useMemo(() => associateChatUiBlocks(events, uiBlocks), [events, uiBlocks])
  const unmatchedUi = React.useMemo(() => {
    const matched = new Set([...uiByEvent.values()].flat().map(block => block.id))
    return uiBlocks.filter(block => !matched.has(block.id))
  }, [uiBlocks, uiByEvent])
  const hasRunningEvent = events.some((event) => event.status === "running")
  const [liveNow, setLiveNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!isRunning && !hasRunningEvent) {
      return
    }

    setLiveNow(Date.now())
    const timer = window.setInterval(() => {
      setLiveNow(Date.now())
    }, 100)

    return () => window.clearInterval(timer)
  }, [hasRunningEvent, isRunning])

  const toggleEvent = (id: string, expanded: boolean) => {
    setExpandedEvents(current => ({ ...current, [id]: !expanded }))
  }

  if (!isRunning && events.length === 0 && ragSources.length === 0 && loadedSkills.length === 0 && uiBlocks.length === 0) {
    return hasUnreadableUi && chat ? <ChatUiMessages chat={chat} /> : null
  }

  const showStatusRow = events.length === 0 && (
    isRunning ||
    status === "failed" ||
    status === "stopped"
  )
  const durationEvents = traceEvents.length > 0 ? traceEvents : events
  const processStartedAt = durationEvents.length > 0
    ? Math.min(...durationEvents.map((event) => event.timestamp))
    : undefined
  const processFinishedAt = durationEvents.length > 0
    ? Math.max(...durationEvents.map((event) => event.timestamp + (event.duration || 0)))
    : undefined
  const processDuration = processStartedAt === undefined
    ? undefined
    : Math.max(0, (isRunning ? liveNow : processFinishedAt || processStartedAt) - processStartedAt)
  const modelExecutionCount = events.filter((event) =>
    event.type === "model_call" || event.type === "model_response"
  ).length
  const processLabel = [
    "已处理",
    processDuration === undefined ? undefined : formatProcessedDuration(processDuration),
    modelExecutionCount > 0 ? `· 执行 ${modelExecutionCount} 次` : undefined,
    modelName ? `· ${modelName}` : undefined,
  ].filter(Boolean).join(" ")

  const processContent = (
    <div className="flex flex-col gap-2">
      <AgentContextTray
        ragSources={ragSources}
        ragSourceDetails={ragSourceDetails}
        loadedSkills={loadedSkills}
      />

      {events.length > 0 && (
        <div role="list" className="flex flex-col gap-1">
          {events.map((event) => {
            const eventUi = uiByEvent.get(event.id) ?? []
            const hasUi = eventUi.length > 0
            const waitingForUi = eventUi.some(block => block.id === pendingUiId && block.status === 'pending')
            const isApproval = event.type === 'approval'
            const isQuestion = event.toolName === 'ask_user_question'
            const ownsRun = Boolean(isRunning && chat && chat.id === activeChatId)
            const activeApproval = isApproval && ownsRun && pendingApproval
              && (pendingApproval.traceEventId ? pendingApproval.traceEventId === event.id : event.status === 'running' && pendingApproval.toolName === event.toolName)
              ? pendingApproval : undefined
            const activeQuestion = isQuestion && ownsRun && pendingQuestion
              && (pendingQuestion.traceEventId === event.id || pendingQuestion.toolCallId === event.id || (!pendingQuestion.traceEventId && !pendingQuestion.toolCallId && event.status === 'running'))
              ? pendingQuestion : undefined
            const hasHostUi = isApproval || isQuestion
            const approvalConfirmed = event.approvalDecision === 'approved' || (event.status === 'success' && event.message === '用户已确认操作。')
            const approvalStatus = activeApproval ? 'input.agent.confirmation.title'
              : approvalConfirmed ? 'input.agent.confirmation.confirmed'
                : event.approvalDecision === 'denied' || event.approvalDecision === 'steered' || event.status === 'error'
                  ? 'input.agent.confirmation.cancelled' : 'input.agent.ui.expired'
            const storedExpanded = expandedEvents[event.id] ?? eventUi.some(block => block.mode === 'display')
            const isModelEvent = event.type === "model_call" || event.type === "model_response"
            const eventLabel = hasUi ? eventUi[0].title : event.toolName
              ? formatAgentToolActivity(event)
              : event.title
            const visibleMessage = !hasUi && !hasHostUi && shouldShowEventMessage(event) ? event.message : undefined
            const modelResponseContent = getModelResponseContent(event)
            const modelReasoningContent = getModelReasoningContent(event)
            const inputDetail = hasUi || hasHostUi ? undefined : compactTraceInput(event)
            const outputDetail = hasUi || hasHostUi || modelResponseContent ? undefined : compactTraceOutput(event, visibleMessage)
            const hasTraceDetails = Boolean(
              visibleMessage || inputDetail !== undefined || outputDetail !== undefined
            )
            const hasDetails = Boolean(
              hasUi ||
              hasHostUi ||
              modelReasoningContent ||
              hasTraceDetails
            )
            const forceExpanded = waitingForUi || Boolean(activeApproval || activeQuestion) || (isModelEvent && event.status === "running")
            const expanded = forceExpanded || storedExpanded
            const canToggle = hasDetails && !forceExpanded
            const displayDuration = event.duration ?? (
              event.status === "running"
                ? Math.max(0, liveNow - event.timestamp)
                : undefined
            )
            const receivedTokenCount = isModelEvent ? getReceivedTokenCount(event) : 0
            return (
              <div key={event.id} role="listitem" className="text-sm">
                <Marker asChild>
                  <button
                    type="button"
                    className="group items-start py-1.5 transition-colors hover:text-foreground"
                    onClick={() => canToggle && toggleEvent(event.id, expanded)}
                    aria-expanded={hasDetails ? expanded : undefined}
                  >
                    <MarkerIcon className="mt-0.5">{eventIcon(event)}</MarkerIcon>
                    <MarkerContent className="flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={expanded ? "min-w-0 break-words [overflow-wrap:anywhere]" : "truncate"}>
                        {eventLabel}
                      </span>
                      {hasUi && <Badge variant="secondary">{t(`input.agent.ui.${eventUi[0].status === 'pending' ? waitingForUi ? 'waiting' : 'expired' : eventUi[0].status}`)}</Badge>}
                      {isApproval && <Badge variant="secondary">{t(approvalStatus)}</Badge>}
                      {isQuestion && <Badge variant="secondary">{t(`input.agent.ui.${activeQuestion ? 'waiting' : hasRecordedQuestionAnswers(event) ? 'submitted' : event.status === 'error' ? 'cancelled' : 'expired'}`)}</Badge>}
                      {displayDuration !== undefined && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatAgentDuration(displayDuration)}
                        </span>
                      )}
                      {receivedTokenCount > 0 && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          · {receivedTokenCount.toLocaleString()} tokens
                        </span>
                      )}
                    </span>
                    {visibleMessage && !expanded && (
                      <span className="mt-1 block max-w-full truncate text-xs text-muted-foreground">
                        {visibleMessage}
                      </span>
                    )}
                    </MarkerContent>
                    {canToggle && (
                      <MarkerIcon className="mt-0.5">
                        {expanded ? <ChevronDown /> : <ChevronRight />}
                      </MarkerIcon>
                    )}
                  </button>
                </Marker>

                {expanded && isApproval && event.toolName && (
                  <div className="min-w-0 pb-2 pl-6">
                    <AgentApprovalPanel
                      pendingConfirmation={activeApproval ?? { toolName: event.toolName, params: event.input ?? {}, ...event.approvalPreview }}
                      readOnly={!activeApproval}
                      embedded
                      onConfirm={scope => confirmPendingAgentAction(scope, activeApproval?.id)}
                      onCancel={() => cancelPendingAgentAction(activeApproval?.id)}
                    />
                  </div>
                )}

                {expanded && isQuestion && (
                  <div className="min-w-0 pb-2 pl-6">
                    {activeQuestion
                      ? <AgentQuestionPanel chatId={chat?.id} traceEventId={event.id} embedded />
                      : <AgentQuestionResult event={event} />}
                  </div>
                )}

                {expanded && hasUi && chat && (
                  <div className="min-w-0 pb-2 pl-6">
                    <ChatUiMessages chat={chat} blocks={eventUi} embedded />
                  </div>
                )}

                {modelReasoningContent && expanded && event.status !== "running" && (
                  <div className="pb-2 pl-6 text-xs">
                    <div className="max-h-48 overflow-y-auto rounded bg-muted/60 p-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-muted-foreground">
                      {modelReasoningContent}
                    </div>
                  </div>
                )}

                {modelResponseContent && event.isIntermediateResponse && event.status !== "running" && (
                  <div className="pb-2">
                    <ChatPreview
                      text={modelResponseContent}
                      containerClassName="max-w-full md:max-w-full"
                    />
                  </div>
                )}

                {expanded && hasTraceDetails && (
                  <div className="flex flex-col gap-2 pb-2 pl-6 text-xs">
                    {visibleMessage && (
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-muted-foreground">{t('input.agent.resultSummary')}</div>
                        <div className="rounded bg-muted/60 p-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-muted-foreground">
                          {visibleMessage}
                        </div>
                      </div>
                    )}
                    {inputDetail !== undefined && (
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-muted-foreground">{t('input.agent.queryParameters')}</div>
                        <pre className={traceDetailClassName(event)}>{formatTraceDetail(inputDetail)}</pre>
                      </div>
                    )}
                    {outputDetail !== undefined && (
                      <div className="flex flex-col gap-1">
                        <div className="font-medium text-muted-foreground">{t('input.agent.toolResult')}</div>
                        <pre className={traceDetailClassName(event)}>{formatTraceDetail(outputDetail)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {chat && unmatchedUi.length > 0 && <ChatUiMessages chat={chat} blocks={unmatchedUi} />}

      {showStatusRow && (
        <Marker role="status" className="py-1.5">
          <MarkerIcon>{statusIcon(status, isRunning)}</MarkerIcon>
          <MarkerContent>{agentStatusText[status]}</MarkerContent>
        </Marker>
      )}

    </div>
  )

  return (
    <div className="space-y-2">
      {isRunning ? processContent : (
        <Collapsible open={processOpen} onOpenChange={setProcessOpen}>
          <CollapsibleTrigger asChild>
            <Marker asChild>
              <button type="button" className="group py-1.5 transition-colors hover:text-foreground">
                <MarkerIcon>{statusIcon(status, isRunning)}</MarkerIcon>
                <MarkerContent className="flex-1 truncate">{processLabel}</MarkerContent>
                <MarkerIcon>
                  <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                </MarkerIcon>
              </button>
            </Marker>
          </CollapsibleTrigger>

          <CollapsibleContent>{processContent}</CollapsibleContent>
        </Collapsible>
      )}
      {hasUnreadableUi && chat && <ChatUiMessages chat={chat} />}
      {!isRunning && status === "stopped" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={chatLoading}
          onClick={() => emitter.emit(
            'quick-prompt-send',
            t('input.agent.resume.prompt')
          )}
        >
          <Play className="size-3.5" />
          {t('input.agent.resume.action')}
        </Button>
      )}
    </div>
  )
}
