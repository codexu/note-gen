"use client"

import * as React from "react"
import { diffLines, diffWords } from "diff"
import { cn } from "@/lib/utils"

export interface DiffViewerProps {
  /** Original content (before) */
  original: string
  /** Modified content (after) */
  modified: string
  /** Display mode: 'lines' for line-by-line, 'words' for word-by-word */
  mode?: "lines" | "words"
  /** Maximum height for the diff container */
  maxHeight?: string | number
  /** Show line numbers */
  showLineNumbers?: boolean
  /** Additional className */
  className?: string
}

interface DiffLine {
  number: number
  content: string
  type: "added" | "removed" | "unchanged" | "empty"
}

export function DiffViewer({
  original,
  modified,
  mode = "lines",
  maxHeight = 600,
  showLineNumbers = true,
  className,
}: DiffViewerProps) {
  const [diffData, setDiffData] = React.useState<DiffLine[]>([])
  const [showAllChangedWarning, setShowAllChangedWarning] = React.useState(false)

  React.useEffect(() => {
    // 标准化行尾符，避免因为行尾符不同导致的误判
    const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, '\n')
    const normalizedOriginal = normalizeLineEndings(original)
    const normalizedModified = normalizeLineEndings(modified)

    if (mode === "lines") {
      const changes = diffLines(normalizedOriginal, normalizedModified)
      const lines: DiffLine[] = []

      let originalLineNum = 1
      let modifiedLineNum = 1

      changes.forEach((part) => {
        const partLines = part.value.split("\n")
        // Remove last empty line if exists (split adds extra)
        if (partLines[partLines.length - 1] === "") {
          partLines.pop()
        }

        partLines.forEach((line) => {
          if (part.removed) {
            lines.push({
              number: originalLineNum++,
              content: line,
              type: "removed",
            })
          } else if (part.added) {
            lines.push({
              number: modifiedLineNum++,
              content: line,
              type: "added",
            })
          } else {
            lines.push({
              number: showLineNumbers ? originalLineNum++ : 0,
              content: line,
              type: "unchanged",
            })
            if (showLineNumbers) modifiedLineNum++
          }
        })
      })

      // 检查是否所有行都被修改了（不包括空行）
      const nonEmptyLines = lines.filter(l => l.content.trim() !== '')
      const changedLines = nonEmptyLines.filter(l => l.type === "added" || l.type === "removed")

      if (nonEmptyLines.length > 0 && changedLines.length === nonEmptyLines.length) {
        setShowAllChangedWarning(true)
      } else {
        setShowAllChangedWarning(false)
      }

      setDiffData(lines)
    } else {
      // Word mode
      const changes = diffWords(normalizedOriginal, normalizedModified)
      let result = ""
      changes.forEach((part) => {
        const className = part.added
          ? "bg-green-500/30 text-green-900 dark:text-green-100"
          : part.removed
          ? "bg-red-500/30 text-red-900 dark:text-red-100 line-through"
          : ""
        result += `<span class="${className}">${part.value}</span>`
      })

      // Convert to lines format for consistent rendering
      setDiffData([
        {
          number: 0,
          content: result,
          type: "unchanged",
        },
      ])
    }
  }, [original, modified, mode, showLineNumbers])

  if (diffData.length === 0) {
    return null
  }

  const containerStyle = maxHeight
    ? { maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight }
    : undefined

  return (
    <div
      className={cn(
        "overflow-auto rounded-lg border bg-muted/50 text-sm font-mono",
        className
      )}
      style={containerStyle}
    >
      <div className="sticky top-0 z-10 flex border-b bg-muted px-4 py-2 font-medium text-xs text-muted-foreground">
        <span className="flex-1">
          {mode === "lines" ? "Line Diff" : "Word Diff"}
        </span>
        <span className="text-xs">
          {diffData.filter((l) => l.type === "added").length} additions,{" "}
          {diffData.filter((l) => l.type === "removed").length} deletions
        </span>
      </div>

      {/* Warning when all lines are changed */}
      {showAllChangedWarning && mode === "lines" && (
        <div className="border-b border-yellow-500/30 bg-yellow-500/5 px-4 py-2 text-xs text-yellow-900 dark:text-yellow-100">
          ⚠️ All lines have been modified. Showing full file comparison.
        </div>
      )}

      <div className="flex">
        <div className="flex-1">
          {mode === "lines" ? (
            diffData.filter((l) => l.type === "added" || l.type === "removed").map((line, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex border-b border-l-2 last:border-b-0",
                  line.type === "added" && "border-l-green-500 bg-green-500/10",
                  line.type === "removed" && "border-l-red-500 bg-red-500/10",
                  line.type === "unchanged" && "border-l-transparent"
                )}
              >
                {showLineNumbers && (
                  <div
                    className={cn(
                      "w-12 shrink-0 border-r px-2 text-center text-xs text-muted-foreground",
                      line.type === "added" && "bg-green-500/5",
                      line.type === "removed" && "bg-red-500/5"
                    )}
                  >
                    {line.number || ""}
                  </div>
                )}
                <pre className="flex-1 whitespace-pre-wrap break-words px-3 py-1">
                  <code
                    className={cn(
                      line.type === "added" && "text-green-900 dark:text-green-100",
                      line.type === "removed" && "text-red-900 dark:text-red-100",
                      line.type === "unchanged" && "text-foreground"
                    )}
                    dangerouslySetInnerHTML={{
                      __html: line.content,
                    }}
                  />
                </pre>
              </div>
            ))
          ) : (
            <div className="p-4">
              <div
                className="whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{
                  __html: diffData[0]?.content || "",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Inline diff component for showing changes in a compact format
 */
export interface InlineDiffProps {
  original: string
  modified: string
  className?: string
}

export function InlineDiff({ original, modified, className }: InlineDiffProps) {
  const changes = diffWords(original, modified)

  return (
    <span className={cn("text-sm", className)}>
      {changes.map((part, idx) => (
        <span
          key={idx}
          className={cn(
            part.added &&
              "bg-green-500/30 text-green-900 dark:text-green-100 rounded px-0.5",
            part.removed &&
              "bg-red-500/30 text-red-900 dark:text-red-100 line-through rounded px-0.5"
          )}
        >
          {part.value}
        </span>
      ))}
    </span>
  )
}
