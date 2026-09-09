"use client"
import * as React from "react"
import { AgentPlan } from "@/components/ui/agent-plan"
import { FileText, ChevronRight, Database, ExternalLink, NotebookPen, PanelsTopLeft } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { createCanvasTab } from "@/app/core/main/canvas/canvas-tab"
import useArticleStore from "@/stores/article"
import useCanvasStore from "@/stores/canvas"
import useMarkStore from "@/stores/mark"
import { useSidebarStore } from "@/stores/sidebar"
import useTagStore from "@/stores/tag"
import { AgentRunTimeline } from "./agent-run-timeline"
import type { AgentRunStatus, AgentSkillSummary, AgentTraceEvent, ToolCall } from "@/lib/agent/types"

interface RagSourceDetail {
  filepath: string
  filename: string
  content: string
  sourceKey?: string
  sourceType?: 'article' | 'record' | 'canvas'
  sourceId?: string
  locator?: {
    filePath?: string
    markId?: number
    tagId?: number
    canvasId?: string
    nodeIds?: string[]
  }
  updatedAt?: number
}

interface AgentPanelWithRagProps {
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
  const router = useRouter()
  const pathname = usePathname()
  const [isRagExpanded, setIsRagExpanded] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState<string[]>([])
  const { setActiveFilePath } = useArticleStore()

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

  const hasStructuredHistory = Boolean(
    structuredHistory?.runId ||
    structuredHistory?.status ||
    structuredHistory?.traceEvents?.length
  )

  // 创建文件名到详情的映射
  const detailMap = React.useMemo(
    () => new Map(ragSourceDetails.map((d) => [d.filename, d])),
    [ragSourceDetails]
  )

  const sourceSummary = React.useMemo(() => {
    const counts = { article: 0, record: 0, canvas: 0, unknown: 0 }
    ragSources.forEach((source) => {
      const sourceType = detailMap.get(source)?.sourceType
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
  }, [detailMap, locale, ragSources, t])

  const handleOpenSource = async (e: React.MouseEvent, detail: RagSourceDetail) => {
    e.stopPropagation()
    if (detail.sourceType === 'record' && detail.locator?.markId) {
      if (detail.locator.tagId) await useTagStore.getState().setCurrentTagId(detail.locator.tagId)
      await useSidebarStore.getState().setLeftSidebarTab('notes')
      await useMarkStore.getState().fetchMarks()
      useMarkStore.getState().setPendingScrollMarkId(detail.locator.markId)
      useMarkStore.getState().setHighlightedMarkId(detail.locator.markId)
      if (pathname.startsWith('/mobile')) router.push('/mobile/record')
      return
    }
    if (detail.sourceType === 'canvas' && detail.locator?.canvasId) {
      const canvasId = detail.locator.canvasId
      useCanvasStore.getState().setPendingFocus({ canvasId, nodeIds: detail.locator.nodeIds || [] })
      const project = await useCanvasStore.getState().openProject(canvasId)
      if (!project) return
      if (pathname.startsWith('/mobile')) {
        router.push(`/mobile/canvas/editor?id=${encodeURIComponent(canvasId)}`)
        return
      }
      await useArticleStore.getState().addTab(createCanvasTab(project))
      await useSidebarStore.getState().setLeftSidebarTab('canvases')
      return
    }
    const filepath = detail.locator?.filePath || detail.filepath
    if (!filepath) return
    await setActiveFilePath(
      filepath,
      true,
      pathname.startsWith('/mobile') ? undefined : { tabOpenMode: 'preview' },
    )
  }

  const sourceIcon = (sourceType?: RagSourceDetail['sourceType']) => {
    if (sourceType === 'record') return <NotebookPen className="size-4 text-muted-foreground" />
    if (sourceType === 'canvas') return <PanelsTopLeft className="size-4 text-muted-foreground" />
    return <FileText className="size-4 text-muted-foreground" />
  }

  const openSourceLabel = (sourceType?: RagSourceDetail['sourceType']) => {
    if (sourceType === 'record') return t('record.chat.ragSources.openRecord')
    if (sourceType === 'canvas') return t('record.chat.ragSources.openCanvas')
    if (sourceType === 'article') return t('record.chat.ragSources.openArticle')
    return t('record.chat.ragSources.openSource')
  }

  // 切换单个文件的展开状态
  const toggleFileExpansion = (filename: string) => {
    setExpandedFiles((prev) =>
      prev.includes(filename)
        ? prev.filter((f) => f !== filename)
        : [...prev, filename]
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
        modelName={structuredHistory?.modelName}
        status={structuredHistory?.status || "completed"}
        isRunning={false}
        traceEvents={structuredHistory?.traceEvents || []}
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
              {isRagExpanded && ragSources.map((source) => {
                const hasDetail = detailMap.has(source)
                const detail = detailMap.get(source)
                const isFileExpanded = expandedFiles.includes(source)

                return (
                  <li key={source} className="mt-1">
                    <button
                      type="button"
                      className="group flex min-h-11 w-full items-center gap-2 py-1 text-left disabled:cursor-default"
                      onClick={() => hasDetail && toggleFileExpansion(source)}
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
                    {isFileExpanded && hasDetail && detail?.content && (
                      <div className="border-muted mt-1 mr-2 mb-1.5 ml-10">
                        <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                          <div className="flex items-center justify-between gap-2 py-1">
                            <div className="flex items-center gap-2">
                              <Database className="size-3.5 text-blue-500 shrink-0" />
                              <span className="font-medium text-xs">{t('record.chat.input.agent.observation')}</span>
                            </div>
                            {detail && (
                              <button
                                onClick={(e) => void handleOpenSource(e, detail)}
                                className="shrink-0 flex items-center gap-1 text-xs text-primary hover:underline"
                                title={openSourceLabel(detail.sourceType)}
                              >
                                <ExternalLink className="size-3" />
                                <span>{openSourceLabel(detail.sourceType)}</span>
                              </button>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap wrap-break-word py-1 text-xs leading-relaxed">
                            {detail.content}
                          </p>
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
    </div>
  )
}
