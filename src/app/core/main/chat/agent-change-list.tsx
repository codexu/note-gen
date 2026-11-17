"use client"

import * as React from "react"
import { Loader2, Undo2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { AgentChange } from "@/lib/agent/types"
import { revertAgentChange } from "@/lib/agent/change-history"
import { EditorChangeDiff } from "./agent-change-diff"

export function AgentChangeList({ changes, chatId, isRunning }: {
  changes: AgentChange[]
  chatId?: number
  isRunning: boolean
}) {
  const t = useTranslations("record.chat.input.agent.changes")
  const [reverting, setReverting] = React.useState<string>()
  const [reverted, setReverted] = React.useState<Record<string, number>>({})
  const [feedback, setFeedback] = React.useState<Record<string, string>>({})
  const files = React.useMemo(() => {
    const grouped = new Map<string, AgentChange[]>()
    for (const change of changes) {
      if (change.type !== "editor" && change.type !== "file") continue
      const key = `${change.workspacePath ?? ""}\u0000${change.target}`
      const group = grouped.get(key) ?? []
      group.push(change)
      grouped.set(key, group)
    }
    return [...grouped.entries()]
  }, [changes])

  const undo = async (change: AgentChange) => {
    if (chatId === undefined || reverting) return
    setReverting(change.id)
    setFeedback(current => ({ ...current, [change.id]: "" }))
    try {
      const result = await revertAgentChange(change, chatId)
      if (result.ok) {
        setReverted(current => ({ ...current, [change.id]: result.revertedAt ?? Date.now() }))
        const notice = result.contentSaved === false ? "undoContentUnsaved"
          : result.refreshComplete === false ? "undoRefreshIncomplete"
            : result.historySaved === false ? "undoHistoryUnsaved" : undefined
        if (notice) setFeedback(current => ({ ...current, [change.id]: t(notice) }))
      } else setFeedback(current => ({ ...current, [change.id]: t(`undoReason.${result.reason ?? "failed"}`) }))
    } catch {
      setFeedback(current => ({ ...current, [change.id]: t("undoReason.failed") }))
    } finally {
      setReverting(undefined)
    }
  }

  if (files.length === 0) return null

  return (
    <section aria-label={t("title")} className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-medium">{t("fileCount", { count: files.length })}</p>
      {files.map(([key, fileChanges]) => (
        <Card key={key} size="sm" className="min-w-0 ring-inset">
          <CardHeader>
            <CardTitle className="break-all">{fileChanges[0].target}</CardTitle>
            <CardDescription>{t("operationCount", { count: fileChanges.length })}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3">
            {[...fileChanges].reverse().map((change, index) => {
              const isReverted = Boolean(change.revertedAt || reverted[change.id])
              const unverified = change.outcome === "unverified"
              const hasActualDiff = unverified
                ? change.before !== undefined && change.after !== undefined
                : change.before !== undefined || change.after !== undefined
              const canRevert = (!unverified || (change.before !== undefined && change.after !== undefined))
                && change.reversible && Boolean(change.workspacePath) && chatId !== undefined
                && (change.type === "file" ? change.before !== undefined || change.after !== undefined
                  : change.before !== undefined && change.after !== undefined)
              const earlierActiveChange = fileChanges.slice(fileChanges.indexOf(change) + 1)
                .some(next => !next.revertedAt && !reverted[next.id])
              const disabledReason = isRunning || reverting ? t("undoReason.busy")
                : earlierActiveChange ? t("undoLatestFirst") : undefined
              const operation = change.before === undefined ? "created" : change.after === undefined ? "deleted" : "updated"
              return (
                <React.Fragment key={change.id}>
                  {index > 0 && <Separator />}
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={isReverted || unverified ? "secondary" : "success"}>{t(isReverted ? "reverted" : unverified ? "unverifiedShort" : "applied")}</Badge>
                      <span className="min-w-0 flex-1 break-words text-sm">{unverified ? t("unverified") : change.before === undefined && change.after === undefined ? change.summary ?? t("updated") : t(operation)}</span>
                      {canRevert && !isReverted && <Button type="button" variant="outline" size="sm"
                        disabled={Boolean(disabledReason)} title={disabledReason} onClick={() => void undo(change)}>
                        {reverting === change.id ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Undo2 data-icon="inline-start" />}
                        {t("undo")}
                      </Button>}
                    </div>
                    {disabledReason && canRevert && !isReverted && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
                    {unverified && hasActualDiff && <p className="text-sm text-muted-foreground">{t("actualDiff")}</p>}
                    {hasActualDiff && <EditorChangeDiff before={change.before ?? ""} after={change.after ?? ""} />}
                    {feedback[change.id] && <p role="status" className="text-sm text-muted-foreground">{feedback[change.id]}</p>}
                  </div>
                </React.Fragment>
              )
            })}
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
