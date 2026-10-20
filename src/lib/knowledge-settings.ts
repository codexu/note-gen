import { Store } from '@tauri-apps/plugin-store'
import type { KnowledgeSource, KnowledgeSourceType } from '@/types/knowledge'

export interface KnowledgeSettings {
  enabledSourceTypes: KnowledgeSourceType[]
  globalSemanticSearchEnabled: boolean
  indexPaused: boolean
}

export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  enabledSourceTypes: ['article', 'record', 'canvas'],
  globalSemanticSearchEnabled: true,
  indexPaused: false,
}

export async function getKnowledgeSettings(): Promise<KnowledgeSettings> {
  const store = await Store.load('store.json')
  return {
    enabledSourceTypes: await store.get<KnowledgeSourceType[]>('ragEnabledSourceTypes')
      ?? DEFAULT_KNOWLEDGE_SETTINGS.enabledSourceTypes,
    globalSemanticSearchEnabled: await store.get<boolean>('ragGlobalSemanticSearchEnabled')
      ?? DEFAULT_KNOWLEDGE_SETTINGS.globalSemanticSearchEnabled,
    indexPaused: await store.get<boolean>('ragKnowledgeIndexPaused')
      ?? DEFAULT_KNOWLEDGE_SETTINGS.indexPaused,
  }
}

export function isKnowledgeSourceEnabled(source: KnowledgeSource, settings: KnowledgeSettings) {
  return settings.enabledSourceTypes.includes(source.sourceType)
}
