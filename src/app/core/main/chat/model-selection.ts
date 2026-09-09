import { Store } from '@tauri-apps/plugin-store'
import type { AiConfig, ModelConfig } from '@/app/core/setting/config'
import useChatStore from '@/stores/chat'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'

export interface GroupedChatModel {
  configKey: string
  configTitle: string
  model: ModelConfig
}

export interface ModelChangeMarker {
  fromModel: string
  toModel: string
  appliesNextTurn: boolean
}

export function collectGroupedChatModels(aiModelList?: AiConfig[]) {
  const models: GroupedChatModel[] = []

  for (const config of aiModelList || []) {
    if (!config.baseURL) continue

    if (config.models?.length) {
      for (const model of config.models) {
        if (model.modelType === 'chat' && model.model) {
          models.push({
            configKey: config.key,
            configTitle: config.title,
            model,
          })
        }
      }
      continue
    }

    if ((config.modelType === 'chat' || !config.modelType) && config.model) {
      models.push({
        configKey: config.key,
        configTitle: config.title,
        model: {
          id: config.key,
          model: config.model,
          modelType: config.modelType || 'chat',
          temperature: config.temperature,
          topP: config.topP,
          voice: config.voice,
          enableStream: config.enableStream,
          maxTokens: config.maxTokens,
          contextWindow: config.contextWindow,
          tokenLimitParam: config.tokenLimitParam,
        },
      })
    }
  }

  return models
}

export function parseModelChangeMarker(content?: string): ModelChangeMarker | null {
  if (!content) return null
  try {
    const marker = JSON.parse(content) as Partial<ModelChangeMarker>
    if (typeof marker.fromModel !== 'string' || typeof marker.toModel !== 'string') {
      return null
    }
    return {
      fromModel: marker.fromModel,
      toModel: marker.toModel,
      appliesNextTurn: marker.appliesNextTurn === true,
    }
  } catch {
    return null
  }
}

export async function changePrimaryChatModel(input: {
  modelId: string
  modelName: string
  previousModelName: string
}) {
  const settingState = useSettingStore.getState()
  const previousModelId = settingState.primaryModel
  if (previousModelId === input.modelId) {
    return { changed: false, appliesNextTurn: false, hasConversationHistory: false }
  }

  const chatState = useChatStore.getState()
  const appliesNextTurn = chatState.loading || chatState.agentState.isRunning

  useChatStore.getState().setReasoningOverride(null)
  settingState.setPrimaryModel(input.modelId)
  const store = await Store.load('store.json')
  await store.set('primaryModel', input.modelId)
  await store.save()

  const hasConversationHistory = chatState.chats.some(chat =>
    chat.type === 'chat' || chat.type === 'note' || chat.type === 'clipboard'
  )
  if (
    previousModelId
    && (chatState.currentConversationId || chatState.isTemporaryConversation)
    && hasConversationHistory
  ) {
    await chatState.insert({
      tagId: chatState.chats.at(-1)?.tagId ?? useTagStore.getState().currentTagId,
      role: 'system',
      type: 'model_change',
      inserted: false,
      content: JSON.stringify({
        fromModel: input.previousModelName || previousModelId,
        toModel: input.modelName || input.modelId,
        appliesNextTurn,
      } satisfies ModelChangeMarker),
    })
  }

  return { changed: true, appliesNextTurn, hasConversationHistory }
}
