"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  ChevronRight,
  Database,
  FileText,
  MoreHorizontal,
  NotebookPen,
  PanelsTopLeft,
  Sparkles,
} from "lucide-react"
import type { AgentSkillSummary } from "@/lib/agent/types"
import { cn } from "@/lib/utils"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { KnowledgeSourceLink } from '@/components/chat-ui/knowledge-source-link'
import { KnowledgeSourceEvidence } from './knowledge-source-evidence'
import type { RagSourceDetail } from '@/types/knowledge'

interface AgentContextTrayProps {
  workspaceFingerprint?: string | null
  ragSources?: string[]
  ragSourceDetails?: RagSourceDetail[]
  loadedSkills?: AgentSkillSummary[]
}

export function AgentContextTray({
  workspaceFingerprint,
  ragSources = [],
  ragSourceDetails = [],
  loadedSkills = [],
}: AgentContextTrayProps) {
  const t = useTranslations('record.chat.ragSources')
  const locale = useLocale()
  const [showRag, setShowRag] = React.useState(false)
  const [showSkills, setShowSkills] = React.useState(false)
  const [expandedSkillDescriptions, setExpandedSkillDescriptions] = React.useState<string[]>([])

  const detailMap = React.useMemo(
    () => new Map(ragSourceDetails.map((detail) => [detail.filename, detail])),
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
      counts.article ? t('articleCount', { count: counts.article }) : '',
      counts.record ? t('recordCount', { count: counts.record }) : '',
      counts.canvas ? t('canvasCount', { count: counts.canvas }) : '',
      counts.unknown ? t('sourceCount', { count: counts.unknown }) : '',
    ].filter(Boolean)
    return new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(parts)
  }, [detailMap, locale, ragSources, ragSourceDetails, t])

  const sourceIcon = (sourceType?: RagSourceDetail['sourceType']) => {
    if (sourceType === 'record') return <NotebookPen />
    if (sourceType === 'canvas') return <PanelsTopLeft />
    return <FileText />
  }

  const sourceTypeLabel = (sourceType?: RagSourceDetail['sourceType']) => {
    if (sourceType === 'record') return t('typeRecord')
    if (sourceType === 'canvas') return t('typeCanvas')
    if (sourceType === 'article') return t('typeArticle')
    return t('typeSource')
  }


  const toggleSkillDescription = (skillId: string) => {
    setExpandedSkillDescriptions((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId]
    )
  }

  if (ragSources.length === 0 && loadedSkills.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1">
      {ragSources.length > 0 && (
        <div>
          <Marker asChild>
            <button
              type="button"
              className="group py-1.5 transition-colors hover:text-foreground"
              aria-expanded={showRag}
              onClick={() => setShowRag((value) => !value)}
            >
              <MarkerIcon><Database /></MarkerIcon>
              <MarkerContent className="flex-1 truncate">{t('label', { sources: sourceSummary })}</MarkerContent>
              <MarkerIcon>
                <ChevronRight className={cn("transition-transform", showRag && "rotate-90")} />
              </MarkerIcon>
            </button>
          </Marker>

          {showRag && (
            <div className="flex flex-col gap-1 pl-6">
              {ragSources.map((source, index) => {
                const indexedDetail = ragSourceDetails[index]
                const detail = indexedDetail?.filename === source ? indexedDetail : detailMap.get(source)
                const sourceIdentity = detail?.sourceKey || `${source}:${index}`
                return (
                  <div key={sourceIdentity} className="flex flex-col gap-1 py-1 text-xs">
                    <Marker>
                      <MarkerIcon>{sourceIcon(detail?.sourceType)}</MarkerIcon>
                      <MarkerContent className="flex-1 truncate">{source}</MarkerContent>
                      {detail && <KnowledgeSourceLink source={detail} articleWorkspace={workspaceFingerprint} />}
                    </Marker>

                    {detail && (
                      <div className="truncate pl-6 text-[11px] text-muted-foreground">
                        {[
                          sourceTypeLabel(detail.sourceType),
                          detail.sourceType === 'article' ? (detail.locator?.filePath || detail.filepath) : undefined,
                          detail.sourceType === 'record' && detail.locator?.tagId ? t('tagLabel', { id: detail.locator.tagId }) : undefined,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {detail && <div className="pl-6"><KnowledgeSourceEvidence detail={detail} /></div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {loadedSkills.length > 0 && (
        <div>
          <Marker asChild>
            <button
              type="button"
              className="group py-1.5 transition-colors hover:text-foreground"
              onClick={() => setShowSkills((value) => !value)}
            >
              <MarkerIcon><Sparkles /></MarkerIcon>
              <MarkerContent className="flex-1 truncate">
                {t('skillsUsed', { count: loadedSkills.length })}
              </MarkerContent>
              <MarkerIcon>
                <ChevronRight className={cn("transition-transform", showSkills && "rotate-90")} />
              </MarkerIcon>
            </button>
          </Marker>

          {showSkills && (
            <div className="flex flex-col gap-2 pl-6">
              {loadedSkills.map((skill) => {
                const descriptionExpanded = expandedSkillDescriptions.includes(skill.id)

                return (
                  <div key={skill.id} className="flex flex-col gap-0.5 py-1 text-xs">
                    <Marker>
                      <MarkerIcon><Sparkles /></MarkerIcon>
                      <MarkerContent className="truncate font-medium text-foreground">{skill.name}</MarkerContent>
                    </Marker>
                    <div className="truncate pl-6 text-muted-foreground">
                      {skill.id}
                    </div>
                    {skill.description && (
                      <div className="flex min-w-0 items-start gap-1 pl-6 text-muted-foreground">
                        <div
                          className={cn(
                            "min-w-0 flex-1",
                            descriptionExpanded ? "whitespace-pre-wrap break-words" : "truncate"
                          )}
                        >
                          {skill.description}
                        </div>
                        <button
                          type="button"
                          className="mt-0.5 shrink-0 rounded px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => toggleSkillDescription(skill.id)}
                          title={descriptionExpanded ? t('collapseDescription') : t('expandDescription')}
                          aria-label={descriptionExpanded ? t('collapseDescription') : t('expandDescription')}
                        >
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </div>
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
