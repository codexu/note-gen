import type { Chat } from '@/db/chats'
import {
  getLatestConversationCompaction,
  initConversationCompactionsDb,
} from '@/db/conversation-compactions'
import { getChatsAfterLastClear } from './history-messages'
import { agentDebugLog } from '@/lib/agent/debug-log'
import {
  resolveModelCapacity,
  type ModelCapacitySource,
} from './model-capacity'
import { getAISettings } from './utils'
import {
  estimateConversationContextBudget,
  getConversationOutputReserve,
} from './conversation-context-budget'

export interface ConversationContextUsage {
  contextWindow: number
  usedTokens: number
  usedPercent: number
  capacitySource: ModelCapacitySource
}

export async function getConversationContextUsage(
  conversationId: number | undefined,
  chats: Chat[],
  input: {
    currentUserInput?: string
    additionalContext?: string
    imageCount?: number
  } = {}
): Promise<ConversationContextUsage | null> {
  const aiConfig = await getAISettings('primaryModel')
  const capacity = await resolveModelCapacity(aiConfig)

  let summary: string | undefined
  let coveredThroughChatId: number | undefined

  if (conversationId) {
    await initConversationCompactionsDb()
    const compaction = await getLatestConversationCompaction(conversationId)
    const lastClear = chats.findLast(chat => chat.type === 'clear')
    if (compaction && (!lastClear || compaction.coveredThroughChatId > lastClear.id)) {
      summary = compaction.summary
      coveredThroughChatId = compaction.coveredThroughChatId
    }
  }

  const history = getChatsAfterLastClear(chats).filter(chat =>
    (chat.type === 'chat' || chat.type === 'note')
    && (
      typeof coveredThroughChatId !== 'number'
      || chat.id > coveredThroughChatId
    )
  )
  const outputReserve = getConversationOutputReserve(aiConfig, capacity)
  const budget = estimateConversationContextBudget(
    summary,
    history,
    {
      currentUserInput: input.currentUserInput || '',
      additionalContext: input.additionalContext,
      imageCount: input.imageCount,
    },
    capacity,
    outputReserve
  )

  agentDebugLog('context_usage_estimated', {
    conversationId: conversationId || null,
    model: aiConfig?.model || '',
    capacitySource: capacity.source,
    contextWindow: capacity.contextWindow,
    chatCount: history.length,
    summaryPresent: Boolean(summary),
    coveredThroughChatId: coveredThroughChatId || null,
    currentInputLength: input.currentUserInput?.length || 0,
    additionalContextLength: input.additionalContext?.length || 0,
    imageCount: input.imageCount || 0,
    ...budget,
  })

  return {
    contextWindow: capacity.contextWindow,
    usedTokens: budget.usedTokens,
    usedPercent: budget.usedPercent,
    capacitySource: capacity.source,
  }
}
