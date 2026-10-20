"use client"

import * as React from "react"
import { CheckCircle2, ChevronDown, ChevronRight, ShieldAlert, XCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { formatConfirmationPreview } from "@/lib/agent/tool-confirmation-display"
import emitter from "@/lib/emitter"
import { cn } from "@/lib/utils"
import { formatAgentToolName } from "./agent-display-utils"

export interface PendingAgentConfirmation {
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
}: AgentApprovalPanelProps) {
  const t = useTranslations()
  const [expanded, setExpanded] = React.useState(true)

  React.useEffect(() => {
    setExpanded(true)
  }, [pendingConfirmation?.toolName, pendingConfirmation?.params])

  React.useEffect(() => {
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
  }, [pendingConfirmation])

  React.useEffect(() => {
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
  }, [pendingConfirmation])

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
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }, [])

  if (!pendingConfirmation || !approvalPreview) {
    return null
  }

  const title = translateKey(
    approvalPreview.titleKey,
    formatAgentToolName(pendingConfirmation.toolName)
  )
  const description = translateKey(
    approvalPreview.descriptionKey,
    "Agent 请求执行需要确认的操作。"
  )
  const hasDetails = approvalPreview.fields.length > 0
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

  return (
    <div className="flex w-full flex-col gap-2 rounded-md border bg-background p-2 shadow-sm">
      <div>
        <button
          type="button"
          className="flex w-full min-w-0 items-start gap-2 text-left"
          onClick={() => hasDetails && setExpanded((value) => !value)}
          disabled={!hasDetails}
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium">{title}</span>
              {hasDetails && (
                expanded ? (
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )
              )}
            </span>
            <span className="block max-w-full truncate text-xs text-muted-foreground">
              {pendingConfirmation.filePath || description}
            </span>
          </span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onCancel}
        >
          <XCircle data-icon="inline-start" />
          {t("record.chat.input.agent.confirmation.cancel")}
        </Button>
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onConfirm?.("once")}
        >
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
        {pendingConfirmation.canApproveForSession && (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            onClick={() => onConfirm?.("conversation")}
          >
            {t("record.chat.input.agent.confirmation.session")}
          </Button>
        )}
      </div>

      {expanded && hasDetails && (
        <div className="mt-2 border-t pt-2">
          {isRemoteSkillInstall && riskWarnings.length > 0 && (
            <Alert variant="destructive" className="mb-2">
              <ShieldAlert />
              <AlertTitle>
                {translateKey(
                  "record.chat.input.agent.confirmation.tools.install_remote_skill.warningTitle",
                  "检测到安装风险"
                )}
              </AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {riskWarnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`}>
                      {formatRiskWarning(warning)}
                      {warning.paths.length > 0 && (
                        <span className="block break-all pl-4 text-xs">
                          {warning.paths.slice(0, 5).join(", ")}
                          {warning.paths.length > 5 ? ` (+${warning.paths.length - 5})` : ""}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {visibleFields.length > 0 && (
            <div className="mt-2 flex max-h-56 flex-col gap-2 overflow-auto text-xs">
              {visibleFields.map((field) => {
                const formattedValue = formatFieldValue(field.value)

                return (
                  <div key={field.name} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
                    <span className="truncate text-muted-foreground">
                      {translateKey(field.labelKey, field.name)}
                    </span>
                    {field.displayType === "content" || field.displayType === "json" ? (
                      <pre
                        className={cn(
                          "whitespace-pre-wrap break-words rounded bg-muted/60 px-2 py-1 text-foreground",
                          field.displayType === "content" && "max-h-[6.75rem] overflow-y-auto leading-5",
                        )}
                      >
                        {formattedValue}
                      </pre>
                    ) : (
                      <span className="break-words text-foreground">{formattedValue}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
