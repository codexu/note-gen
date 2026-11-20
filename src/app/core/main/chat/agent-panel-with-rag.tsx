"use client"
import * as React from "react"
import { AgentPlan } from "@/components/ui/agent-plan"
import { FileText, ChevronRight, Database, NotebookPen, PanelsTopLeft } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"
import { AgentRunTimeline } from "./agent-run-timeline"
import type { AgentChange, AgentRunStatus, AgentSkillSummary, AgentTraceEvent, ToolCall } from "@/lib/agent/types"
import type { Chat } from "@/db/chats"
import { ChatUiMessages } from "@/components/chat-ui/chat-ui-messages"
import { getChatResponseWorkspaceFingerprint } from '@/lib/chat-ui/response-host'
import { KnowledgeSourceLink } from '@/components/chat-ui/knowledge-source-link'
import { KnowledgeSourceEvidence } from './knowledge-source-evidence'
import type { RagSourceDetail } from '@/types/knowledge'

interface AgentPanelWithRagProps {
  chat?: Chat
  // RAG 相关
  ragSources?: string[]
  ragSourceDetails?: RagSourceDetail[]

  // Agent 历史模式
  agentHistoryJson?: string

  // Agent 实时模式（如果需要）
  isRunning?: boolean
  isThinking?: boolean
  currentThought?: string
  thoughtHistory?: string[]
  completedSteps?: Array<{
    thought: string
    action?: { tool: string; params: Record<string, any> }
    observation?: string
    duration?: number
  }>
  currentAction?: string
  currentObservation?: string
  toolCalls?: Array<{
    id: string
    toolName: string
    params: Record<string, any>
    result?: { success: boolean; message?: string; data?: any; error?: string }
    status: "pending" | "running" | "success" | "error"
    timestamp: number
  }>
  pendingConfirmation?: {
    toolName: string
    params: Record<string, any>
    originalContent?: string
    modifiedContent?: string
    filePath?: string
    from?: number
    to?: number
    canApproveForSession?: boolean
    sessionApprovalType?: "runtime-script"
    sessionApprovalKey?: string
  }
  confirmationHistory?: Array<{
    toolName: string
    params: Record<string, any>
    status: "pending" | "confirmed" | "cancelled"
    timestamp: number
    scope?: "once" | "conversation"
    sessionApprovalType?: "runtime-script"
    sessionApprovalKey?: string
  }>
  currentStepStartTime?: number
  onConfirm?: (scope?: "once" | "conversation") => void
  onCancel?: () => void
}

interface StructuredAgentHistory {
  changes?: AgentChange[]
  modelName?: string
  runId?: string
  status?: AgentRunStatus
  traceEvents?: AgentTraceEvent[]
  toolCalls?: ToolCall[]
  loadedSkills?: AgentSkillSummary[]
}

/**
 * Agent 面板组件 - 将知识库检索和 Agent 执行合并在一起
 */
export function AgentPanelWithRag({
  chat,
  ragSources = [],
  ragSourceDetails = [],
  agentHistoryJson,
  isRunning = false,
  isThinking = false,
  currentThought = "",
  thoughtHistory = [],
  completedSteps = [],
  currentAction = "",
  currentObservation = "",
  toolCalls = [],
  pendingConfirmation,
  confirmationHistory = [],
  currentStepStartTime,
  onConfirm,
  onCancel,
}: AgentPanelWithRagProps) {
  const t = useTranslations()
  const locale = useLocale()
  const [isRagExpanded, setIsRagExpanded] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState<string[]>([])

  const structuredHistory = React.useMemo<StructuredAgentHistory | null>(() => {
    if (!agentHistoryJson) {
      return null
    }

    try {
      const parsed = JSON.parse(agentHistoryJson) as StructuredAgentHistory
      return parsed && typeof parsed === "object" ? parsed : null
    } catch {
      return null
    }
  }, [agentHistoryJson])

  const workspaceFingerprint = getChatResponseWorkspaceFingerprint(structuredHistory)
  const hasStructuredHistory = Boolean(
    structuredHistory?.runId ||
    structuredHistory?.status ||
    structuredHistory?.traceEvents?.length || structuredHistory?.changes?.length
  )

  // 创建文件名到详情的映射
  const detailMap = React.useMemo(
    () => new Map(ragSourceDetails.map((d) => [d.filename, d])),
    [ragSourceDetails]
  )

  const sourceSummary = React.useMemo(() => {
    const counts = { article: 0, record: 0, canvas: 0, unknown: 0 }
    ragSources.forEach((source, index) => {
      const indexedDetail = ragSourceDetails[index]
      const detail = indexedDetail?.filename === source ? indexedDetail : detailMap.get(source)
      const sourceType = detail?.sourceType
      if (sourceType) counts[sourceType] += 1
      else counts.unknown += 1
    })
    const parts = [
      counts.article ? t('record.chat.ragSources.articleCount', { count: counts.article }) : '',
      counts.record ? t('record.chat.ragSources.recordCount', { count: counts.record }) : '',
      counts.canvas ? t('record.chat.ragSources.canvasCount', { count: counts.canvas }) : '',
      counts.unknown ? t('record.chat.ragSources.sourceCount', { count: counts.unknown }) : '',
    ].filter(Boolean)
    return new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(parts)
  }, [detailMap, locale, ragSources, ragSourceDetails, t])

  const sourceIcon = (sourceType?: RagSourceDetail['sourceType']) => {
    if (sourceType === 'record') return <NotebookPen className="size-4 text-muted-foreground" />
    if (sourceType === 'canvas') return <PanelsTopLeft className="size-4 text-muted-foreground" />
    return <FileText className="size-4 text-muted-foreground" />
  }


  // 切换单个文件的展开状态
  const toggleFileExpansion = (sourceIdentity: string) => {
    setExpandedFiles((prev) =>
      prev.includes(sourceIdentity)
        ? prev.filter((f) => f !== sourceIdentity)
        : [...prev, sourceIdentity]
    )
  }

  // 确定模式：如果有 agentHistoryJson，使用历史模式；否则使用实时模式
  const mode: "live" | "history" = agentHistoryJson ? "history" : "live"

  // 如果既没有 RAG 也没有 Agent 内容，不渲染
  const hasRag = ragSources.length > 0
  const hasAgent = agentHistoryJson || isRunning || thoughtHistory.length > 0

  if (!hasRag && !hasAgent) {
    return null
  }

  if (hasStructuredHistory) {
    return (
      <AgentRunTimeline
        chat={chat}
        modelName={structuredHistory?.modelName}
        status={structuredHistory?.status || "completed"}
        isRunning={false}
        traceEvents={structuredHistory?.traceEvents || []}
        changes={structuredHistory?.changes || []}
        toolCalls={structuredHistory?.toolCalls || []}
        ragSources={ragSources}
        ragSourceDetails={ragSourceDetails}
        loadedSkills={structuredHistory?.loadedSkills || []}
      />
    )
  }

  return (
    <div className="w-full">
      <div className="overflow-hidden">
        <ul className="space-y-2">
          {/* 知识库检索步骤 */}
          {hasRag && (
            <>
              <li>
                <button
                  type="button"
                  className="group flex min-h-11 w-full items-center gap-2 py-2 text-left"
                  onClick={() => setIsRagExpanded(!isRagExpanded)}
                  aria-expanded={isRagExpanded}
                >
                  <div className="shrink-0">
                    <Database className="size-4.5 text-blue-500" />
                  </div>
                  <div className="flex min-w-0 grow items-center justify-between">
                    <span className="text-sm">
                      {t("record.chat.ragSources.label", { sources: sourceSummary })}
                    </span>
                    <ChevronRight
                      className={`size-4 text-muted-foreground shrink-0 transition-transform ${
                        isRagExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </div>
                </button>
              </li>

              {/* 文件列表 */}
              {isRagExpanded && ragSources.map((source, index) => {
                const indexedDetail = ragSourceDetails[index]
                const detail = indexedDetail?.filename === source ? indexedDetail : detailMap.get(source)
                const sourceIdentity = detail?.sourceKey || `${source}:${index}`
                const hasDetail = Boolean(detail)
                const isFileExpanded = expandedFiles.includes(sourceIdentity)

                return (
                  <li key={sourceIdentity} className="mt-1">
                    <button
                      type="button"
                      className="group flex min-h-11 w-full items-center gap-2 py-1 text-left disabled:cursor-default"
                      onClick={() => hasDetail && toggleFileExpansion(sourceIdentity)}
                      disabled={!hasDetail}
                      aria-expanded={hasDetail ? isFileExpanded : undefined}
                    >
                      <div className="shrink-0">
                        <div className="size-4.5" />
                      </div>
                      <div className="shrink-0">
                        {sourceIcon(detail?.sourceType)}
                      </div>
                      <div className="flex min-w-0 grow items-center justify-between gap-2">
                        <span
                          className={`truncate text-sm ${
                            hasDetail
                              ? "text-foreground group-hover:text-primary transition-colors"
                              : "text-muted-foreground"
                          }`}
                        >
                          {source}
                        </span>
                        {hasDetail && (
                          <ChevronRight
                            className={`size-4 text-muted-foreground shrink-0 transition-transform ${
                              isFileExpanded ? "rotate-90" : ""
                            }`}
                          />
                        )}
                      </div>
                    </button>



                    {/* 展开的详情内容 */}
                    {isFileExpanded && detail && (
                      <div className="border-muted mt-1 mr-2 mb-1.5 ml-10">
                        <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                          <div className="flex items-center justify-between gap-2 py-1">
                            <div className="flex items-center gap-2">
                              <Database className="size-3.5 text-blue-500 shrink-0" />
                              <span className="font-medium text-xs">{t('record.chat.input.agent.observation')}</span>
                            </div>
                            <KnowledgeSourceLink source={detail} articleWorkspace={workspaceFingerprint ?? (chat || agentHistoryJson ? null : undefined)} />
                          </div>
                          <KnowledgeSourceEvidence detail={detail} />
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </>
          )}

          {/* Agent 执行步骤 - 使用 AgentPlan embedded 模式 */}
          {hasAgent && (
            <AgentPlan
              mode={mode}
              isRunning={isRunning}
              isThinking={isThinking}
              currentThought={currentThought}
              thoughtHistory={thoughtHistory}
              completedSteps={completedSteps}
              currentAction={currentAction}
              currentObservation={currentObservation}
              toolCalls={toolCalls}
              pendingConfirmation={pendingConfirmation}
              confirmationHistory={confirmationHistory}
              currentStepStartTime={currentStepStartTime}
              historyJson={agentHistoryJson}
              onConfirm={onConfirm}
              onCancel={onCancel}
              embedded={true}
            />
          )}
        </ul>
      </div>
      {chat && <ChatUiMessages chat={chat} />}
    </div>
  )
}
