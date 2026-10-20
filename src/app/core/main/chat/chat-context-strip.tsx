"use client"

import {
  ChartArea,
  ChartColumn,
  ChartLine,
  ChartNoAxesCombined,
  ChartPie,
  FileText,
  FolderOpen,
  Globe2,
  Gauge,
  LockKeyhole,
  LockKeyholeOpen,
  Package,
  Palette,
  Radar,
  TextSelect,
  Waypoints,
  X,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { isLinkedFolder, type LinkedResource } from "@/lib/files"
import type { PendingQuote } from "@/stores/chat"
import type { CanvasSelectionContext } from "@/types/canvas"
import type { SkillMetadata } from "@/lib/skills/types"
import type { MarkdownFile } from "@/lib/files"
import type { Mark } from "@/db/marks"
import {
  getMarkTypeIconClasses,
  MARK_TYPE_ICONS,
} from "@/app/core/main/mark/mark-type-meta"

export interface MentionedRecord extends PendingQuote {
  markType: Mark["type"]
}

export type MentionedContext =
  | { kind: "file"; file: MarkdownFile }
  | { kind: "record"; record: MentionedRecord }
  | { kind: "canvas"; canvas: CanvasSelectionContext }

export function getMentionedContextKey(context: MentionedContext) {
  if (context.kind === "file") return `file:${context.file.path}`
  if (context.kind === "record") return `record:${context.record.articlePath}`
  return `canvas:${context.canvas.canvasId}`
}

export const getLinkedResourceContextKey = (resource: LinkedResource) => `resource:${resource.relativePath}`
export const getBrowserContextKey = (tabId: string, url: string) => `browser:${tabId}:${url}`
export const getQuoteContextKey = (quote: PendingQuote) => `quote:${quote.articlePath}:${quote.from}:${quote.to}:${quote.quote}`
export const getCanvasSelectionContextKey = (context: CanvasSelectionContext) => `canvas-selection:${context.canvasId}`
export const getSkillContextKey = (skillId: string) => `skill:${skillId}`

interface ChatContextStripProps {
  linkedResource: LinkedResource | null
  activeTabContexts: MentionedContext[]
  browserPages: { tabId: string; title: string; url: string }[]
  quoteData: PendingQuote | null
  canvasContext: CanvasSelectionContext | null
  selectedSkills: SkillMetadata[]
  mentionedContexts: MentionedContext[]
  onRemoveLinkedResource: () => void
  onRemoveActiveTabContext: (key: string) => void
  onRemoveBrowserPage: (key: string) => void
  onRemoveQuote: () => void
  onRemoveCanvas: () => void
  onRemoveSkill: (skillId: string) => void
  onRemoveMentionedContext: (key: string) => void
  lockedKeys: string[]
  onToggleLock: (key: string) => void
}

function ContextBadge({
  icon,
  label,
  contextKey,
  locked,
  onToggleLock,
  onRemove,
}: {
  icon: React.ReactNode
  label: string
  contextKey: string
  locked: boolean
  onToggleLock: (key: string) => void
  onRemove: () => void
}) {
  const t = useTranslations('record.chat.input')
  return (
    <Badge
      variant="secondary"
      className="group/context h-7 max-w-40 shrink-0 gap-1 rounded-lg pl-2 pr-0.5 font-normal"
      title={label}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center self-center">
        <span className="flex size-3.5 items-center justify-center group-hover/context:opacity-0 group-focus-within/context:opacity-0 [&>svg]:size-3.5!" aria-hidden="true">
          {locked ? <LockKeyhole /> : icon}
        </span>
        <button
          type="button"
          className="absolute inset-0 flex items-center justify-center rounded-sm opacity-0 outline-none group-hover/context:opacity-100 group-focus-within/context:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-3.5!"
          onClick={() => onToggleLock(contextKey)}
          aria-label={t(locked ? 'unlockContext' : 'lockContext')}
          aria-pressed={locked}
          title={t(locked ? 'unlockContext' : 'lockContext')}
        >
          {locked ? <LockKeyholeOpen /> : <LockKeyhole />}
        </button>
      </span>
      <span className="truncate leading-none">{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0"
        onClick={onRemove}
        aria-label={`${t('removeContext')}：${label}`}
      >
        <X />
      </Button>
    </Badge>
  )
}

function getQuoteLabel(quote: PendingQuote) {
  const selectedText = quote.quote.replace(/\s+/g, " ").trim()

  if (quote.startLine <= 0 || quote.endLine < quote.startLine) {
    return selectedText || quote.fileName
  }

  const selectedLines = quote.startLine === quote.endLine
    ? `L${quote.startLine}`
    : `L${quote.startLine}–${quote.endLine}`

  return selectedText ? `${selectedLines} · ${selectedText}` : selectedLines
}

function getCanvasContextLabel(
  context: CanvasSelectionContext,
  formatNodes: (nodes: number) => string,
  formatNodesAndRelations: (nodes: number, relations: number) => string
) {
  if (context.scope === "canvas" || context.nodes.length === 0) {
    return context.canvasTitle
  }

  const nodeLabels = new Map(
    context.nodes.map(node => [node.id, node.label.replace(/\s+/g, " ").trim() || node.id])
  )
  const selectedNodes = [...nodeLabels.values()]
  if (selectedNodes.length === 1) {
    return selectedNodes[0]
  }

  const relationshipCount = context.edges.filter(edge => (
    nodeLabels.has(edge.source) && nodeLabels.has(edge.target)
  )).length

  return relationshipCount > 0
    ? formatNodesAndRelations(selectedNodes.length, relationshipCount)
    : formatNodes(selectedNodes.length)
}

function getCanvasContextIcon(context: CanvasSelectionContext) {
  if (context.scope === "canvas") return <Palette />
  if (context.nodes.length !== 1 || context.nodes[0].type !== "chart") return <Waypoints />

  switch (context.nodes[0].chart?.type) {
    case "area":
      return <ChartArea />
    case "bar":
      return <ChartColumn />
    case "line":
      return <ChartLine />
    case "pie":
      return <ChartPie />
    case "radar":
      return <Radar />
    case "radial":
      return <Gauge />
    default:
      return <ChartNoAxesCombined />
  }
}

function CanvasContextBadge({
  context,
  contextKey,
  locked,
  onToggleLock,
  onRemove,
}: {
  context: CanvasSelectionContext
  contextKey: string
  locked: boolean
  onToggleLock: (key: string) => void
  onRemove: () => void
}) {
  const t = useTranslations("canvas.selection")
  const label = getCanvasContextLabel(
    context,
    nodes => t("chatContextNodes", { nodes }),
    (nodes, relations) => t("chatContextNodesAndRelations", { nodes, relations })
  )

  return (
    <ContextBadge
      icon={getCanvasContextIcon(context)}
      label={label}
      contextKey={contextKey}
      locked={locked}
      onToggleLock={onToggleLock}
      onRemove={onRemove}
    />
  )
}

function MentionedContextBadge({
  context,
  locked,
  onToggleLock,
  onRemove,
}: {
  context: MentionedContext
  locked: boolean
  onToggleLock: (key: string) => void
  onRemove: () => void
}) {
  const contextKey = getMentionedContextKey(context)
  if (context.kind === "file") {
    return <ContextBadge icon={<FileText />} label={context.file.name} contextKey={contextKey} locked={locked} onToggleLock={onToggleLock} onRemove={onRemove} />
  }
  if (context.kind === "record") {
    const RecordIcon = MARK_TYPE_ICONS[context.record.markType]
    return (
      <ContextBadge
        icon={<RecordIcon className={getMarkTypeIconClasses(context.record.markType)} />}
        label={context.record.fileName}
        contextKey={contextKey}
        locked={locked}
        onToggleLock={onToggleLock}
        onRemove={onRemove}
      />
    )
  }
  return <CanvasContextBadge context={context.canvas} contextKey={contextKey} locked={locked} onToggleLock={onToggleLock} onRemove={onRemove} />
}

export function ChatContextStrip({
  linkedResource,
  activeTabContexts,
  browserPages,
  quoteData,
  canvasContext,
  selectedSkills,
  mentionedContexts,
  onRemoveLinkedResource,
  onRemoveActiveTabContext,
  onRemoveBrowserPage,
  onRemoveQuote,
  onRemoveCanvas,
  onRemoveSkill,
  onRemoveMentionedContext,
  lockedKeys,
  onToggleLock,
}: ChatContextStripProps) {
  const locked = new Set(lockedKeys)
  if (
    !linkedResource
    && activeTabContexts.length === 0
    && browserPages.length === 0
    && !quoteData
    && !canvasContext
    && selectedSkills.length === 0
    && mentionedContexts.length === 0
  ) return null

  return (
    <div className="flex w-full max-w-full flex-wrap gap-1 px-1 pt-1">
      {linkedResource ? (
        <ContextBadge
          icon={isLinkedFolder(linkedResource) ? <FolderOpen /> : <FileText />}
          label={linkedResource.name}
          contextKey={getLinkedResourceContextKey(linkedResource)}
          locked={locked.has(getLinkedResourceContextKey(linkedResource))}
          onToggleLock={onToggleLock}
          onRemove={onRemoveLinkedResource}
        />
      ) : null}
      {activeTabContexts.map(context => {
        const key = getMentionedContextKey(context)
        return (
          <MentionedContextBadge
            key={key}
            context={context}
            locked={locked.has(key)}
            onToggleLock={onToggleLock}
            onRemove={() => onRemoveActiveTabContext(key)}
          />
        )
      })}
      {browserPages.map(browserPage => (
        <ContextBadge
          key={getBrowserContextKey(browserPage.tabId, browserPage.url)}
          icon={<Globe2 />}
          label={browserPage.title || new URL(browserPage.url).hostname}
          contextKey={getBrowserContextKey(browserPage.tabId, browserPage.url)}
          locked={locked.has(getBrowserContextKey(browserPage.tabId, browserPage.url))}
          onToggleLock={onToggleLock}
          onRemove={() => onRemoveBrowserPage(getBrowserContextKey(browserPage.tabId, browserPage.url))}
        />
      ))}
      {quoteData ? (
        <ContextBadge
          icon={<TextSelect />}
          label={getQuoteLabel(quoteData)}
          contextKey={getQuoteContextKey(quoteData)}
          locked={locked.has(getQuoteContextKey(quoteData))}
          onToggleLock={onToggleLock}
          onRemove={onRemoveQuote}
        />
      ) : null}
      {canvasContext ? (
        <CanvasContextBadge context={canvasContext} contextKey={getCanvasSelectionContextKey(canvasContext)} locked={locked.has(getCanvasSelectionContextKey(canvasContext))} onToggleLock={onToggleLock} onRemove={onRemoveCanvas} />
      ) : null}
      {mentionedContexts.map(context => {
        const key = getMentionedContextKey(context)
        return (
          <MentionedContextBadge
            key={key}
            context={context}
            locked={locked.has(key)}
            onToggleLock={onToggleLock}
            onRemove={() => onRemoveMentionedContext(key)}
          />
        )
      })}
      {selectedSkills.map(skill => (
        <ContextBadge
          key={skill.id}
          icon={<Package />}
          label={skill.name}
          contextKey={getSkillContextKey(skill.id)}
          locked={locked.has(getSkillContextKey(skill.id))}
          onToggleLock={onToggleLock}
          onRemove={() => onRemoveSkill(skill.id)}
        />
      ))}
    </div>
  )
}
