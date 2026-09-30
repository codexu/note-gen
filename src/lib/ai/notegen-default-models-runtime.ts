import { Store } from '@tauri-apps/plugin-store'

import type { AiConfig, ModelConfig, ModelType } from '@/app/core/setting/config'
import { fetchConfigCenterConfig } from '@/lib/config-center/client'
import { loadNoteGenModelPolicy } from './notegen-model-policy'

export const NOTEGEN_DEFAULT_MODELS_CACHE_KEY = 'noteGenDefaultModelsCache'

interface NoteGenDefaultModelsCache {
  versionCode?: number
  versionName?: string
  fetchedAt: string
  content: {
    models: unknown[]
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isModelType(value: unknown): value is ModelType {
  return (
    value === 'chat' ||
    value === 'image' ||
    value === 'video' ||
    value === 'tts' ||
    value === 'stt' ||
    value === 'embedding' ||
    value === 'rerank'
  )
}

function parseContentPayload(payload: unknown) {
  if (!payload) {
    return null
  }

  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload)
    } catch {
      return null
    }
  }

  if (typeof payload === 'object') {
    return payload
  }

  return null
}

function normalizeModelItem(item: Record<string, unknown>): ModelConfig | null {
  if (!isNonEmptyString(item.id) || !isNonEmptyString(item.model)) {
    return null
  }

  const modelType = isModelType(item.modelType) ? item.modelType : 'chat'

  return {
    id: item.id.trim(),
    model: item.model.trim(),
    modelType,
    temperature: typeof item.temperature === 'number' ? item.temperature : undefined,
    topP: typeof item.topP === 'number' ? item.topP : undefined,
    voice: isNonEmptyString(item.voice) ? item.voice.trim() : undefined,
    enableStream: typeof item.enableStream === 'boolean' ? item.enableStream : undefined,
    maxTokens: typeof item.maxTokens === 'number' ? item.maxTokens : undefined,
    contextWindow: typeof item.contextWindow === 'number' ? item.contextWindow : undefined,
    tokenLimitParam: item.tokenLimitParam === 'max_tokens'
      ? 'max_tokens'
      : item.tokenLimitParam === 'max_completion_tokens'
        ? 'max_completion_tokens'
        : undefined,
  }
}

function normalizeNoteGenDefaultModelsPayload(payload: unknown): ModelConfig[] {
  const parsedPayload = parseContentPayload(payload)
  const payloadObject = parsedPayload && typeof parsedPayload === 'object'
    ? parsedPayload as Record<string, unknown>
    : {}

  if (Array.isArray(payloadObject.models)) {
    return payloadObject.models
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(normalizeModelItem)
      .filter((item): item is ModelConfig => !!item)
  }

  const defaultModels = payloadObject.defaultModels
  if (defaultModels && typeof defaultModels === 'object' && !Array.isArray(defaultModels)) {
    return Object.entries(defaultModels as Record<string, unknown>)
      .filter(([, model]) => isNonEmptyString(model))
      .map(([id, model]) => ({
        id,
        model: String(model).trim(),
        modelType: 'chat' as const,
      }))
  }

  return []
}

function mergeNoteGenDefaultModels(config: AiConfig, remoteModels: ModelConfig[]): AiConfig {
  if (!config.models?.length || remoteModels.length === 0) {
    return config
  }

  // The Limited alias must survive older remote configs that still publish Qwen.
  remoteModels = remoteModels.filter(model => model.modelType !== 'chat')
  const remoteModelById = new Map(remoteModels.map((model) => [model.id, model]))
  const builtinModelIds = new Set(config.models.map((model) => model.id))

  return {
    ...config,
    models: [
      ...config.models.map((model) => {
        const remoteModel = remoteModelById.get(model.id)
        if (!remoteModel) {
          return model
        }

        return {
          ...model,
          ...remoteModel,
        }
      }),
      ...remoteModels.filter((model) => !builtinModelIds.has(model.id)),
    ],
  }
}

async function fetchNoteGenDefaultModelsFromConfigCenter(versionCode?: number | null): Promise<NoteGenDefaultModelsCache | null> {
  const result = await fetchConfigCenterConfig('noteGenDefaultModels', versionCode)
  if (result.status === 'not-modified') {
    return null
  }

  const models = normalizeNoteGenDefaultModelsPayload(result.payload)
  if (models.length === 0) {
    throw new Error('Config center NoteGen default models payload is empty')
  }

  return {
    versionCode: result.versionCode,
    versionName: result.versionName,
    fetchedAt: new Date().toISOString(),
    content: {
      models,
    },
  }
}

export async function loadNoteGenDefaultConfig(builtinConfig: AiConfig): Promise<AiConfig> {
  const policy = await loadNoteGenModelPolicy()
  builtinConfig = { ...builtinConfig, title: policy.title }
  const store = await Store.load('store.json')
  const cached = await store.get<NoteGenDefaultModelsCache>(NOTEGEN_DEFAULT_MODELS_CACHE_KEY)

  try {
    const latest = await fetchNoteGenDefaultModelsFromConfigCenter(cached?.versionCode)
    if (latest) {
      await store.set(NOTEGEN_DEFAULT_MODELS_CACHE_KEY, latest)
      await store.save()
      return mergeNoteGenDefaultModels(builtinConfig, normalizeNoteGenDefaultModelsPayload(latest.content))
    }

    if (cached?.content?.models?.length) {
      return mergeNoteGenDefaultModels(builtinConfig, normalizeNoteGenDefaultModelsPayload(cached.content))
    }
  } catch (error) {
    console.error('[notegen-default-models] failed to fetch config center models', error)
  }

  if (cached?.content?.models?.length) {
    return mergeNoteGenDefaultModels(builtinConfig, normalizeNoteGenDefaultModelsPayload(cached.content))
  }

  return builtinConfig
}

export function applyNoteGenDefaultConfig(aiModelList: AiConfig[], noteGenConfig: AiConfig): AiConfig[] {
  aiModelList = aiModelList.filter(config => !['note-gen-limited', 'note-gen-chat', 'note-gen-vlm'].includes(config.key))
  const hasNoteGenConfig = aiModelList.some((config) => config.key === noteGenConfig.key)

  if (!hasNoteGenConfig) {
    return [...aiModelList, noteGenConfig]
  }

  return aiModelList.map((config) => {
    if (config.key !== noteGenConfig.key) {
      return config
    }

    return {
      ...config,
      ...noteGenConfig,
      models: noteGenConfig.models,
    }
  })
}
