import type { AiConfig } from '@/app/core/setting/config'
import type { Chat } from '@/db/chats'
import type { ModelCapacity } from './model-capacity'
import { estimateTokens } from './token-counter'

export const DEFAULT_OUTPUT_RESERVE = 2_048
export const MIN_RECENT_HISTORY_BUDGET = 512

type ConversationUsageInput = {
  currentUserInput: string
  additionalContext?: string
  imageCount?: number
}

export interface ConversationContextBudget {
  projected: number
  availableInput: number
  historyBudget: number
  usedTokens: number
  usedPercent: number
  summaryTokens: number
  historyTokens: number
  additionalContextTokens: number
  currentInputTokens: number
  imageTokens: number
  runtimeReserve: number
  outputReserve: number
  safetyMargin: number
}

export function getConversationOutputReserve(
  config: Pick<AiConfig, 'maxTokens'> | undefined,
  capacity: ModelCapacity
) {
  return Math.min(
    Math.max(config?.maxTokens || DEFAULT_OUTPUT_RESERVE, 512),
    Math.max(512, Math.floor(capacity.contextWindow * 0.4))
  )
}

export function estimateConversationContextBudget(
  summary: string | undefined,
  history: Chat[],
  input: ConversationUsageInput,
  capacity: ModelCapacity,
  outputReserve: number
): ConversationContextBudget {
  const safetyMargin = Math.max(1_024, Math.floor(capacity.contextWindow * 0.15))
  const runtimeReserve = Math.min(4_000, Math.floor(capacity.contextWindow * 0.25))
  const availableInput = Math.max(
    1_024,
    capacity.contextWindow - outputReserve - safetyMargin
  )
  const summaryTokens = estimateTokens(summary || '')
  const historyTokens = history.reduce(
    (sum, chat) => sum + estimateTokens(chat.content || ''),
    0
  )
  const additionalContextTokens = estimateTokens(input.additionalContext || '')
  const currentInputTokens = estimateTokens(input.currentUserInput)
  const imageTokens = (input.imageCount || 0) * 2_048
  const variableTokens =
    summaryTokens +
    historyTokens +
    additionalContextTokens +
    currentInputTokens +
    imageTokens
  const projected = runtimeReserve + variableTokens
  const usedTokens = projected + outputReserve

  return {
    projected,
    availableInput,
    historyBudget: Math.max(
      MIN_RECENT_HISTORY_BUDGET,
      availableInput
        - runtimeReserve
        - summaryTokens
        - additionalContextTokens
        - currentInputTokens
        - imageTokens
    ),
    usedTokens,
    usedPercent: Math.min(
      100,
      Math.max(0, Math.round((usedTokens / capacity.contextWindow) * 100))
    ),
    summaryTokens,
    historyTokens,
    additionalContextTokens,
    currentInputTokens,
    imageTokens,
    runtimeReserve,
    outputReserve,
    safetyMargin,
  }
}
