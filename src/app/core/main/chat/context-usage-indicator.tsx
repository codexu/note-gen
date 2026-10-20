"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ConversationContextUsage } from "@/lib/ai/conversation-context-usage"
import { agentDebugLog } from "@/lib/agent/debug-log"
import emitter from "@/lib/emitter"
import useChatStore from "@/stores/chat"
import useSettingStore from "@/stores/setting"

const CIRCLE_RADIUS = 9
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}M`
  }
  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1))}K`
  }
  return String(value)
}

function isConfirmedCapacity(source: ConversationContextUsage["capacitySource"] | undefined) {
  return source === "user" || source === "learned"
}

interface ContextUsageIndicatorProps {
  currentUserInput: string
  additionalContext?: string
  imageCount?: number
}

export function ContextUsageIndicator({
  currentUserInput,
  additionalContext,
  imageCount = 0,
}: ContextUsageIndicatorProps) {
  const t = useTranslations("record.chat.input.contextUsage")
  const primaryModel = useSettingStore(state => state.primaryModel)
  const aiModelList = useSettingStore(state => state.aiModelList)
  const chats = useChatStore(state => state.chats)
  const loading = useChatStore(state => state.loading)
  const currentConversationId = useChatStore(state => state.currentConversationId)
  const isTemporaryConversation = useChatStore(state => state.isTemporaryConversation)
  const [usage, setUsage] = React.useState<ConversationContextUsage | null>(null)
  const [compactionRevision, setCompactionRevision] = React.useState(0)
  const [manualCompacting, setManualCompacting] = React.useState(false)
  const hasConversationHistory = chats.some(
    chat => chat.type === "chat" || chat.type === "note"
  )
  const hasConfirmedCapacity = isConfirmedCapacity(usage?.capacitySource)

  React.useEffect(() => {
    const handleStatus = (event: {
      conversationId: number
      status: 'running' | 'completed' | 'failed'
    }) => {
      if (
        event.status === 'completed'
        && event.conversationId === currentConversationId
      ) {
        setCompactionRevision(revision => revision + 1)
      }
    }

    emitter.on('conversation-compaction-status', handleStatus)
    return () => {
      emitter.off('conversation-compaction-status', handleStatus)
    }
  }, [currentConversationId])

  React.useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const { getConversationContextUsage } = await import(
          "@/lib/ai/conversation-context-usage"
        )
        const nextUsage = await getConversationContextUsage(
          isTemporaryConversation ? undefined : currentConversationId || undefined,
          chats,
          {
            currentUserInput,
            additionalContext,
            imageCount,
          }
        )
        if (!cancelled) {
          setUsage(nextUsage)
          const visible = Boolean(
            nextUsage
            && hasConversationHistory
            && isConfirmedCapacity(nextUsage.capacitySource)
          )
          agentDebugLog("context_usage_indicator_evaluated", {
            conversationId: currentConversationId,
            available: Boolean(nextUsage),
            usedPercent: nextUsage?.usedPercent ?? null,
            capacitySource: nextUsage?.capacitySource ?? null,
            currentInputLength: currentUserInput.length,
            additionalContextLength: additionalContext?.length || 0,
            imageCount,
            visible,
            hiddenReason: !nextUsage
              ? "context_usage_unavailable"
              : !isConfirmedCapacity(nextUsage.capacitySource)
                ? "context_capacity_unconfirmed"
                : visible
                  ? null
                  : "no_conversation_history",
          })
        }
      } catch (error) {
        console.error("[ContextUsage] Failed to estimate context usage:", error)
        if (!cancelled) {
          setUsage(null)
        }
      }
    }, 150)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    aiModelList,
    chats,
    compactionRevision,
    currentUserInput,
    currentConversationId,
    additionalContext,
    imageCount,
    hasConversationHistory,
    isTemporaryConversation,
    loading,
    primaryModel,
  ])

  const handleManualCompaction = async () => {
    if (
      loading
      || manualCompacting
      || isTemporaryConversation
      || !currentConversationId
    ) {
      return
    }

    setManualCompacting(true)
    agentDebugLog("conversation_manual_compaction_requested", {
      conversationId: currentConversationId,
      usedPercent: usage?.usedPercent ?? null,
      contextWindow: usage?.contextWindow ?? null,
    })

    try {
      const { prepareConversationHistory } = await import("@/lib/ai/condense")
      const result = await prepareConversationHistory({
        conversationId: currentConversationId,
        chats,
        currentUserInput,
        additionalContext,
        imageCount,
        force: true,
      })
      agentDebugLog("conversation_manual_compaction_completed", {
        conversationId: currentConversationId,
        compacted: result.compacted,
        revision: result.compaction?.revision ?? null,
        contextWindow: result.capacity.contextWindow,
      })
    } catch (error) {
      console.error("[ConversationCompaction] Manual compaction failed:", error)
    } finally {
      setManualCompacting(false)
      setCompactionRevision(revision => revision + 1)
    }
  }

  if (
    !usage
    || !hasConversationHistory
    || !hasConfirmedCapacity
  ) {
    return null
  }

  const dashOffset = CIRCLE_CIRCUMFERENCE * (1 - usage.usedPercent / 100)
  const label = t("label", { percent: usage.usedPercent })
  const usageDetail = t("usageDetail", {
    percent: usage.usedPercent,
  })
  const tokenDetail = t("tokenDetail", {
    usedTokens: formatTokenCount(usage.usedTokens),
    contextWindow: formatTokenCount(usage.contextWindow),
  })
  const compactionUnavailable =
    loading
    || manualCompacting
    || isTemporaryConversation
    || !currentConversationId

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-8 w-8">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={compactionUnavailable}
            aria-label={label}
            onClick={handleManualCompaction}
            className="h-8 w-8 p-0 text-muted-foreground"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className={`size-4 -rotate-90 ${
                manualCompacting ? "animate-spin" : ""
              }`}
            >
              <circle
                cx="12"
                cy="12"
                r={CIRCLE_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                opacity="0.25"
              />
              <circle
                cx="12"
                cy="12"
                r={CIRCLE_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={CIRCLE_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                className="transition-[stroke-dashoffset] duration-300"
              />
            </svg>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div>
          <p>{usageDetail}</p>
          <p>{tokenDetail}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
