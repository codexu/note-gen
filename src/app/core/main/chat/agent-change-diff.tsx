"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, WrapText } from "lucide-react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { buildLineDiff } from "@/lib/agent/text-diff"
import { cn } from "@/lib/utils"

const CONTEXT_LINES = 3
const REVEAL_LINES = 40
const CHANGE_PAGE_LINES = 200

type DiffSegment = { from: number; to: number; hidden: boolean }

export function EditorChangeDiff({ before, after, defaultOpen = false, proposed = false, showLineEndings = true }: {
  before: string
  after: string
  defaultOpen?: boolean
  proposed?: boolean
  showLineEndings?: boolean
}) {
  const t = useTranslations("record.chat.input.agent.changes")
  const [open, setOpen] = React.useState(defaultOpen)
  const [wrap, setWrap] = React.useState(true)
  const [revealed, setRevealed] = React.useState<Record<number, number>>({})
  const [shownChanges, setShownChanges] = React.useState<Record<number, number>>({})
  const [activeHunk, setActiveHunk] = React.useState(0)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const hunkRefs = React.useRef(new Map<number, HTMLDivElement>())
  // History may contain many full-document snapshots. Compare only the diff
  // the user opens; closed cards must not synchronously process every document.
  const lines = React.useMemo(() => open ? buildLineDiff(before, after) : undefined, [open, before, after])
  const added = lines?.filter(line => line.type === "add").length ?? 0
  const removed = lines?.filter(line => line.type === "remove").length ?? 0
  const changedLineEndings = React.useMemo(() => {
    const endings = new Map<string, Set<string>>()
    for (const line of lines ?? []) {
      if (line.type === "equal" || !line.lineEnding) continue
      const values = endings.get(line.text) ?? new Set<string>()
      values.add(line.lineEnding)
      endings.set(line.text, values)
    }
    return endings
  }, [lines])
  const segments = React.useMemo(() => {
    if (!lines) return []
    const visible = new Uint8Array(lines.length)
    lines.forEach((line, index) => {
      if (line.type === "equal") return
      visible.fill(1, Math.max(0, index - CONTEXT_LINES), Math.min(lines.length, index + CONTEXT_LINES + 1))
    })
    const result: DiffSegment[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const hidden = visible[index] === 0
      const previous = result.at(-1)
      if (previous && previous.hidden === hidden) previous.to = index + 1
      else result.push({ from: index, to: index + 1, hidden })
    }
    return result
  }, [lines])
  const hunks = segments.filter(segment => !segment.hidden)

  React.useEffect(() => {
    setRevealed({})
    setShownChanges({})
    setActiveHunk(0)
    setOpen(defaultOpen)
  }, [before, after, defaultOpen])

  const navigateHunk = (index: number) => {
    const hunk = hunks[index]
    if (!hunk) return
    const container = scrollRef.current
    const target = hunkRefs.current.get(hunk.from)
    if (!container || !target) return
    setActiveHunk(index)
    container.scrollTo({
      top: container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 28,
      behavior: "auto",
    })
    target.focus({ preventScroll: true })
  }

  const renderLines = (from: number, to: number) => lines?.slice(from, to).map((line, offset) => (
    <div key={from + offset} className={cn(
      "grid min-w-full grid-cols-[2.75rem_2.75rem_1.25rem_minmax(0,1fr)] font-mono text-xs leading-5",
      !wrap && "w-max grid-cols-[2.75rem_2.75rem_1.25rem_auto]",
      line.type === "add" && "bg-success/10",
      line.type === "remove" && "bg-destructive/10",
    )}>
      <span aria-hidden="true" className="select-none px-1 text-right tabular-nums text-muted-foreground">{line.oldLine ?? ""}</span>
      <span aria-hidden="true" className="select-none px-1 text-right tabular-nums text-muted-foreground">{line.newLine ?? ""}</span>
      <span aria-hidden="true" className="select-none text-center">{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}</span>
      <code className={cn("min-w-0 pr-2", wrap ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]" : "whitespace-pre")}>
        <span className="sr-only">{t(line.type === "add" ? "addedLine" : line.type === "remove" ? "removedLine" : "contextLine")}: </span>
        {line.text || "\u00a0"}
        {showLineEndings && line.type !== "equal" && line.lineEnding && (line.lineEnding !== "lf" || (changedLineEndings.get(line.text)?.size ?? 0) > 1) && (
          <Badge variant="outline" className="ml-2 align-middle">{t(line.lineEnding === "none" ? "noNewline" : line.lineEnding)}</Badge>
        )}
      </code>
    </div>
  ))

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 rounded-md border">
      <div className="flex flex-wrap items-center gap-1 p-1">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            {open ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
            {t(proposed ? "proposedDiff" : "diff")}
          </Button>
        </CollapsibleTrigger>
        {lines && <Badge variant="outline" aria-label={t("addedCount", { count: added })}>+{added}</Badge>}
        {lines && <Badge variant="outline" aria-label={t("removedCount", { count: removed })}>−{removed}</Badge>}
        {hunks.length > 0 && <span className="text-xs text-muted-foreground">{t("hunkCount", { count: hunks.length })}</span>}
        {open && <Button type="button" variant="ghost" size="sm" className="ml-auto" aria-pressed={wrap} onClick={() => setWrap(value => !value)}>
          <WrapText data-icon="inline-start" />{t("wrap")}
        </Button>}
      </div>
      <CollapsibleContent>
        {hunks.length > 1 && <div className="flex items-center justify-end gap-1 border-t px-1 py-1">
          <span aria-live="polite" className="mr-auto px-1 text-xs text-muted-foreground">{t("hunkPosition", { current: activeHunk + 1, total: hunks.length })}</span>
          <Button type="button" variant="ghost" size="sm" disabled={activeHunk === 0} onClick={() => navigateHunk(activeHunk - 1)}>
            <ArrowUp data-icon="inline-start" />{t("previous")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={activeHunk === hunks.length - 1} onClick={() => navigateHunk(activeHunk + 1)}>
            <ArrowDown data-icon="inline-start" />{t("next")}
          </Button>
        </div>}
        {lines && (added + removed === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">{t("unchanged")}</p>
        ) : (
          <div ref={scrollRef} role="region" aria-label={t("diffRegion")} tabIndex={0}
            onScroll={() => {
              const container = scrollRef.current
              if (!container) return
              const top = container.getBoundingClientRect().top + 28
              const next = hunks.findIndex(hunk => {
                const element = hunkRefs.current.get(hunk.from)
                return element && element.getBoundingClientRect().bottom > top
              })
              if (next >= 0) setActiveHunk(next)
            }}
            className="max-h-96 overflow-auto overscroll-contain rounded-b-md border-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="sticky top-0 grid grid-cols-[2.75rem_2.75rem_1fr] border-b bg-muted px-0 py-1 text-center text-xs text-muted-foreground">
              <span>{t("before")}</span><span>{t("after")}</span><span className="text-left">{t("content")}</span>
            </div>
            {segments.map(segment => {
              if (!segment.hidden) {
                const end = Math.min(segment.to, segment.from + (shownChanges[segment.from] ?? CHANGE_PAGE_LINES))
                return <div key={segment.from} tabIndex={-1} ref={element => {
                  if (element) hunkRefs.current.set(segment.from, element)
                  else hunkRefs.current.delete(segment.from)
                }} className="focus:outline-none">
                  {renderLines(segment.from, end)}
                  {end < segment.to && <div className="flex justify-center p-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => setShownChanges(current => ({ ...current, [segment.from]: end - segment.from + CHANGE_PAGE_LINES }))}>
                      {t("showMoreChanges", { count: segment.to - end })}
                    </Button>
                  </div>}
                </div>
              }
              const count = Math.min(revealed[segment.from] ?? 0, segment.to - segment.from)
              const remaining = segment.to - segment.from - count
              return (
                <React.Fragment key={segment.from}>
                  {renderLines(segment.from, segment.from + count)}
                  <div className="flex min-w-0 items-center justify-center gap-1 bg-muted/40 p-1">
                    {remaining > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed(current => ({ ...current, [segment.from]: count + REVEAL_LINES }))}>
                      {t("showContext", { count: remaining })}
                    </Button>}
                    {count > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setRevealed(current => ({ ...current, [segment.from]: 0 }))}>
                      {t("hideContext")}
                    </Button>}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
