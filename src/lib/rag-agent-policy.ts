import { Store } from '@tauri-apps/plugin-store'

export type RagAgentStrategy = 'fast' | 'balanced' | 'deep'

export interface RagAgentPolicy {
  automaticSearchEnabled: boolean
  strategy: RagAgentStrategy
  maxSearchRounds: number
}

export const DEFAULT_RAG_AGENT_POLICY = {
  automaticSearchEnabled: true,
  strategy: 'balanced' as RagAgentStrategy,
}

const SEARCH_ROUNDS_BY_STRATEGY: Record<RagAgentStrategy, number> = {
  fast: 1,
  balanced: 2,
  deep: 3,
}

function isRagAgentStrategy(value: unknown): value is RagAgentStrategy {
  return value === 'fast' || value === 'balanced' || value === 'deep'
}

export function getRagAgentSearchRoundLimit(strategy: RagAgentStrategy): number {
  return SEARCH_ROUNDS_BY_STRATEGY[strategy]
}

export async function getRagAgentPolicy(): Promise<RagAgentPolicy> {
  const store = await Store.load('store.json')
  const storedAutomaticSearchEnabled = await store.get<boolean>('ragAutomaticSearchEnabled')
  const legacyRagEnabled = await store.get<boolean>('isRagEnabled')
  const automaticSearchEnabled = storedAutomaticSearchEnabled
    ?? legacyRagEnabled
    ?? DEFAULT_RAG_AGENT_POLICY.automaticSearchEnabled
  const storedStrategy = await store.get<string>('ragAgentStrategy')
  const strategy = isRagAgentStrategy(storedStrategy)
    ? storedStrategy
    : DEFAULT_RAG_AGENT_POLICY.strategy

  return {
    automaticSearchEnabled,
    strategy,
    maxSearchRounds: getRagAgentSearchRoundLimit(strategy),
  }
}
