"use client"
import * as React from "react"
import { AgentPlan } from "@/components/ui/agent-plan"
import { FileText, ChevronRight, Database, ExternalLink } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import useArticleStore from "@/stores/article"

interface RagSourceDetail {
  filepath: string
  filename: string
  content: string
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
    canApproveForSession?: boolean
    sessionApprovalType?: "write" | "runtime-script-skill"
    sessionApprovalSkillId?: string
  }
  confirmationHistory?: Array<{
    toolName: string
    params: Record<string, any>
    status: "pending" | "confirmed" | "cancelled"
    timestamp: number
    scope?: "once" | "conversation"
    sessionApprovalType?: "write" | "runtime-script-skill"
    sessionApprovalSkillId?: string
  }>
  currentStepStartTime?: number
  onConfirm?: (scope?: "once" | "conversation") => void
  onCancel?: () => void
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
  const [isRagExpanded, setIsRagExpanded] = useState(false)
  const [expandedFiles, setExpandedFiles] = useState<string[]>([])
  const { setActiveFilePath, readArticle } = useArticleStore()

  // 创建文件名到详情的映射
  const detailMap = React.useMemo(
    () => new Map(ragSourceDetails.map((d) => [d.filename, d])),
    [ragSourceDetails]
  )

  // 打开文件
  const handleOpenFile = (e: React.MouseEvent, filepath: string) => {
    e.stopPropagation()
    setActiveFilePath(filepath)
    readArticle(filepath)
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

  return (
    <div className="w-full">
      <div className="overflow-hidden">
        <ul className="space-y-2">
          {/* 知识库检索步骤 */}
          {hasRag && (
            <>
              <li>
                <div
                  className="group flex items-center gap-2 py-2 cursor-pointer"
                  onClick={() => setIsRagExpanded(!isRagExpanded)}
                >
                  <div className="shrink-0">
                    <Database className="size-4.5 text-blue-500" />
                  </div>
                  <div className="flex min-w-0 grow items-center justify-between">
                    <span className="text-sm">
                      {t("record.chat.ragSources.label", { count: ragSources.length })}
                    </span>
                    <ChevronRight
                      className={`size-4 text-muted-foreground shrink-0 transition-transform ${
                        isRagExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </div>
                </div>
              </li>

              {/* 文件列表 */}
              {isRagExpanded && ragSources.map((source) => {
                const hasDetail = detailMap.has(source)
                const detail = detailMap.get(source)
                const isFileExpanded = expandedFiles.includes(source)

                return (
                  <li key={source} className="mt-1">
                    <div
                      className="group flex items-center gap-2 py-1 cursor-pointer"
                      onClick={() => hasDetail && toggleFileExpansion(source)}
                    >
                      <div className="shrink-0">
                        <div className="size-4.5" />
                      </div>
                      <div className="shrink-0">
                        <FileText className="size-4 text-muted-foreground" />
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
                    </div>

                    {/* 展开的详情内容 */}
                    {isFileExpanded && hasDetail && detail?.content && (
                      <div className="border-muted mt-1 mr-2 mb-1.5 ml-10">
                        <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                          <div className="flex items-center justify-between gap-2 py-1">
                            <div className="flex items-center gap-2">
                              <Database className="size-3.5 text-blue-500 shrink-0" />
                              <span className="font-medium text-xs">引用内容</span>
                            </div>
                            {detail?.filepath && (
                              <button
                                onClick={(e) => handleOpenFile(e, detail.filepath)}
                                className="shrink-0 flex items-center gap-1 text-xs text-primary hover:underline"
                                title={t("record.chat.ragSources.openFile", { defaultValue: "Open file" })}
                              >
                                <ExternalLink className="size-3" />
                                <span>打开文件</span>
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
