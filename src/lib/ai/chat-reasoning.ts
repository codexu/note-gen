import type { AiConfig, ReasoningEffort } from '@/app/core/setting/config'
import { getReasoningEfforts } from './tauri-client'

export interface ChatReasoningOverride {
  modelId: string
  modelKey: string
  effort: ReasoningEffort
}

export function getReasoningModelKey(config: AiConfig): string {
  return JSON.stringify([config.key, config.baseURL, config.model])
}

export function applyChatReasoningOverride(
  config: AiConfig | undefined,
  modelId: string,
  override: ChatReasoningOverride | null,
): AiConfig | undefined {
  if (!config) return undefined
  const defaultConfig = { ...config, reasoningEffort: undefined }
  if (!override || override.modelId !== modelId
    || override.modelKey !== getReasoningModelKey(config)) return defaultConfig
  const supported = getReasoningEfforts(config)
  if (supported && !supported.includes(override.effort)) return defaultConfig
  return { ...config, reasoningEffort: override.effort }
}
