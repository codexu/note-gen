"use client"

import * as React from "react"
import { CheckCircle2, ChevronDown, ChevronRight, ShieldAlert, XCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ApprovalUi, type ApprovalUiModel } from "@/components/chat-ui/approval-ui"
import { formatConfirmationPreview } from "@/lib/agent/tool-confirmation-display"
import emitter from "@/lib/emitter"
import { formatAgentToolName } from "./agent-display-utils"

export interface PendingAgentConfirmation {
  id?: string
  runId?: string
  chatId?: number
  conversationId?: number
  traceEventId?: string
  workspacePath?: string
  toolName: string
  params: Record<string, unknown>
  previewParams?: Record<string, unknown>
  originalContent?: string
  modifiedContent?: string
  filePath?: string
  from?: number
  to?: number
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
}: AgentApprovalPanelProps) {
  const t = useTranslations()
  const [expanded, setExpanded] = React.useState(false)

  React.useEffect(() => {
    setExpanded(false)
  }, [pendingConfirmation?.id, pendingConfirmation?.toolName, pendingConfirmation?.params])

  React.useEffect(() => {
    if (readOnly) return
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
  const visibleFields = isRemoteSkillInstall
    ? approvalPreview.fields.filter(
        (field) => !["preview_id", "warnings", "skipped_symlinks"].includes(field.name)
      )
    : approvalPreview.fields

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
                disabled={!onConfirm}
                onClick={() => onConfirm?.("conversation")}
              >
                {t("record.chat.input.agent.confirmation.session")}
              </Button>}
              <Button type="button" size="sm" disabled={!onConfirm} onClick={() => onConfirm?.("once")}>
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
