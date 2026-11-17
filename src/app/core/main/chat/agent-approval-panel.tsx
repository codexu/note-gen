"use client"

import * as React from "react"
import { CheckCircle2, ChevronDown, ChevronRight, ShieldAlert, XCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ApprovalUi, type ApprovalUiModel } from "@/components/chat-ui/approval-ui"
import { formatConfirmationPreview } from "@/lib/agent/tool-confirmation-display"
import { agentDebugLog } from "@/lib/agent/debug-log"
import type { AgentEditPreview } from "@/lib/agent/types"
import emitter from "@/lib/emitter"
import { formatAgentToolName } from "./agent-display-utils"
import { EditorChangeDiff } from "./agent-change-diff"

export { EditorChangeDiff } from "./agent-change-diff"

export interface PendingAgentConfirmation extends AgentEditPreview {
  id?: string
  runId?: string
  chatId?: number
  conversationId?: number
  traceEventId?: string
  workspacePath?: string
  toolName: string
  params: Record<string, unknown>
  canApproveForSession?: boolean
  sessionApprovalType?: "runtime-script"
  sessionApprovalKey?: string
}

interface AgentApprovalPanelProps {
  pendingConfirmation?: PendingAgentConfirmation
  onConfirm?: (scope?: "once" | "conversation") => void
  onCancel?: () => void
  readOnly?: boolean
  embedded?: boolean
  showProposedDiff?: boolean
  outcome?: "applied" | "not-applied" | "cancelled" | "stale" | "unverified"
}

interface RemoteSkillRiskWarning {
  code: string
  actual: number
  recommended: number
  paths: string[]
}

function formatRiskBytes(value: number) {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

export function AgentApprovalPanel({
  pendingConfirmation,
  onConfirm,
  onCancel,
  readOnly = false,
  embedded = false,
  showProposedDiff = false,
  outcome,
}: AgentApprovalPanelProps) {
  const t = useTranslations()
  const [expanded, setExpanded] = React.useState(false)
  const [previewSkipped, setPreviewSkipped] = React.useState(false)
  const [previewStale, setPreviewStale] = React.useState(false)

  React.useEffect(() => {
    setPreviewStale(false)
    if (readOnly) return
    const stale = ({ filePath, version }: { filePath: string; version?: number }) => {
      if (pendingConfirmation?.filePath === filePath
        && (version === undefined || version === pendingConfirmation.version)) setPreviewStale(true)
    }
    emitter.on('editor-agent-diff-stale', stale)
    return () => emitter.off('editor-agent-diff-stale', stale)
  }, [pendingConfirmation, readOnly])

  React.useEffect(() => {
    setExpanded(false)
  }, [pendingConfirmation?.id, pendingConfirmation?.toolName, pendingConfirmation?.params])

  React.useEffect(() => {
    setPreviewSkipped(false)
    if (readOnly || pendingConfirmation?.kind === "file") return
    agentDebugLog("editor_diff_approval_state", {
      toolName: pendingConfirmation?.toolName,
      filePath: pendingConfirmation?.filePath,
      hasOriginal: pendingConfirmation?.originalContent !== undefined,
      hasModified: pendingConfirmation?.modifiedContent !== undefined,
    })
    if (
      pendingConfirmation?.originalContent === undefined ||
      pendingConfirmation.modifiedContent === undefined
    ) {
      emitter.emit("editor-agent-diff-clear")
      return
    }

    emitter.emit("editor-agent-diff-preview", {
      originalContent: pendingConfirmation.originalContent,
      modifiedContent: pendingConfirmation.modifiedContent,
      filePath: pendingConfirmation.filePath,
      from: pendingConfirmation.from,
      to: pendingConfirmation.to,
      version: pendingConfirmation.version,
      baseContent: pendingConfirmation.baseContent,
      parseInlineMarkdown: pendingConfirmation.parseInlineMarkdown,
      onSkipped: () => setPreviewSkipped(true),
    })

    return () => {
      emitter.emit("editor-agent-diff-clear")
    }
  }, [pendingConfirmation, readOnly])

  React.useEffect(() => {
    if (readOnly) return
    if (pendingConfirmation?.toolName !== "canvas_apply_operations") {
      emitter.emit("canvas-agent-preview-clear")
      return
    }

    const operations = pendingConfirmation.params.operations
    if (!Array.isArray(operations)) {
      emitter.emit("canvas-agent-preview-clear")
      return
    }

    emitter.emit("canvas-agent-preview", { operations })
    return () => emitter.emit("canvas-agent-preview-clear")
  }, [pendingConfirmation, readOnly])

  const approvalPreview = React.useMemo(() => {
    if (!pendingConfirmation) return null
    return formatConfirmationPreview(
      pendingConfirmation.toolName,
      pendingConfirmation.previewParams ?? pendingConfirmation.params ?? {}
    )
  }, [pendingConfirmation])

  const translateKey = React.useCallback((key: string, fallback: string) => {
    return t.has(key) ? t(key) : fallback
  }, [t])

  const formatFieldValue = React.useCallback((value: unknown) => {
    if (typeof value === "string") {
      return value
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      value === undefined
    ) {
      return String(value)
    }

    try {
      return JSON.stringify(value, null, 2) ?? String(value)
    } catch {
      return String(value)
    }
  }, [])

  if (!pendingConfirmation || !approvalPreview) {
    return null
  }

  const title = approvalPreview.titleKey === "record.chat.input.agent.confirmation.fallback.title"
    ? formatAgentToolName(pendingConfirmation.toolName)
    : translateKey(approvalPreview.titleKey, formatAgentToolName(pendingConfirmation.toolName))
  const description = translateKey(
    approvalPreview.descriptionKey,
    "Agent 请求执行需要确认的操作。"
  )
  const isRemoteSkillInstall = pendingConfirmation.toolName === "skill_install_source"
  const riskWarnings = Array.isArray(pendingConfirmation.params.warnings)
    ? pendingConfirmation.params.warnings.filter(
        (value): value is RemoteSkillRiskWarning => (
          typeof value === "object"
          && value !== null
          && typeof (value as RemoteSkillRiskWarning).code === "string"
          && typeof (value as RemoteSkillRiskWarning).actual === "number"
          && typeof (value as RemoteSkillRiskWarning).recommended === "number"
          && Array.isArray((value as RemoteSkillRiskWarning).paths)
        )
      )
    : []
  const visibleFields = approvalPreview.fields.filter(field => (
    !["expectedContent", "workspaceIdentity", "expectedSelection"].includes(field.name)
    && (!isRemoteSkillInstall || !["preview_id", "warnings", "skipped_symlinks"].includes(field.name))
  ))

  const formatRiskWarning = (warning: RemoteSkillRiskWarning) => {
    const key = `record.chat.input.agent.confirmation.tools.install_remote_skill.risks.${warning.code}`
    const values = {
      actual: warning.actual,
      recommended: warning.recommended,
      actualSize: formatRiskBytes(warning.actual),
      recommendedSize: formatRiskBytes(warning.recommended),
      count: warning.actual,
    }
    if (t.has(key)) {
      return t(key, values)
    }
    return warning.code
  }

  const model: ApprovalUiModel = {
    fields: visibleFields.map(field => ({
      label: translateKey(field.labelKey, field.name),
      value: formatFieldValue(field.value),
      format: field.displayType,
    })),
    warningTitle: translateKey(
      "record.chat.input.agent.confirmation.tools.install_remote_skill.warningTitle",
      "检测到安装风险"
    ),
    warnings: isRemoteSkillInstall ? riskWarnings.map(warning => ({
      message: formatRiskWarning(warning),
      paths: warning.paths.filter((path): path is string => typeof path === "string"),
    })) : [],
  }
  const summaryFieldNames = new Set([
    "filePath", "fileName", "folderPath", "sourcePath", "targetPath", "newName",
    "name", "skill_id", "script_id", "scriptName", "source",
  ])
  const summaryFields = visibleFields.filter(field => (
    summaryFieldNames.has(field.name)
    && typeof field.value === "string"
    && field.value.trim().length > 0
  ))
  const summary = summaryFields.length > 0
    ? summaryFields.map(field => summaryFields.length === 1
      ? formatFieldValue(field.value)
      : `${translateKey(field.labelKey, field.name)}: ${formatFieldValue(field.value)}`
    ).join(" · ")
    : pendingConfirmation.filePath || description
  const hasDetails = model.fields.length > 0

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Card size="sm" className="w-full min-w-0 ring-inset">
        <CardHeader className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 basis-40">
            <CardTitle className="flex items-center gap-2">
              {!embedded && <ShieldAlert className="size-4 shrink-0" />}
              <span className="min-w-0 break-words">{title}</span>
            </CardTitle>
            <CardDescription className="line-clamp-2 break-all" title={summary}>
              {summary}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {hasDetails && <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                {t("record.chat.input.agent.confirmation.parameters")}
                {expanded ? <ChevronDown data-icon="inline-end" /> : <ChevronRight data-icon="inline-end" />}
              </Button>
            </CollapsibleTrigger>}
            {!readOnly && <>
              <Button type="button" size="sm" variant="ghost" disabled={!onCancel} onClick={onCancel}>
                <XCircle data-icon="inline-start" />
                {t("record.chat.input.agent.confirmation.cancel")}
              </Button>
              {pendingConfirmation.canApproveForSession && <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!onConfirm || previewStale}
                onClick={() => onConfirm?.("conversation")}
              >
                {t("record.chat.input.agent.confirmation.session")}
              </Button>}
              <Button type="button" size="sm" disabled={!onConfirm || previewStale} onClick={() => onConfirm?.("once")}>
                <CheckCircle2 data-icon="inline-start" />
                {isRemoteSkillInstall
                  ? riskWarnings.length > 0
                    ? translateKey(
                        "record.chat.input.agent.confirmation.tools.install_remote_skill.continue",
                        "继续安装"
                      )
                    : translateKey(
                        "record.chat.input.agent.confirmation.tools.install_remote_skill.confirm",
                        "确认安装"
                      )
                  : t("record.chat.input.agent.confirmation.confirm")}
              </Button>
            </>}
          </div>
        </CardHeader>

        {pendingConfirmation.originalContent !== undefined && pendingConfirmation.modifiedContent !== undefined && (
          <CardContent className="flex min-w-0 flex-col gap-2">
            {outcome && <p role="status" className="text-sm text-muted-foreground">{t(`record.chat.input.agent.changes.${outcome}`)}</p>}
            {previewStale && !outcome && <p role="status" className="text-sm text-muted-foreground">{t("record.chat.input.agent.changes.stalePreview")}</p>}
            {previewSkipped && !previewStale && !outcome && <p role="status" className="text-sm text-muted-foreground">{t("record.chat.input.agent.changes.inlineUnavailable")}</p>}
            <EditorChangeDiff
              before={pendingConfirmation.originalContent}
              after={pendingConfirmation.modifiedContent}
              defaultOpen={!readOnly || showProposedDiff}
              proposed={outcome !== "applied"}
              showLineEndings={pendingConfirmation.from === undefined && pendingConfirmation.to === undefined}
            />
          </CardContent>
        )}

        {model.warnings.length > 0 && <CardContent className="min-w-0">
          <ApprovalUi model={{ ...model, fields: [] }} />
        </CardContent>}

        {hasDetails && <CollapsibleContent asChild>
          <CardContent className="min-w-0">
            <ApprovalUi model={{ ...model, warnings: [] }} />
          </CardContent>
        </CollapsibleContent>}
      </Card>
    </Collapsible>
  )
}
