import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import type OpenAI from 'openai';
import { AiConfig } from "@/app/core/setting/config";
import { readFile } from "@tauri-apps/plugin-fs";
import { platform } from "@tauri-apps/plugin-os";
import { createTauriOpenAIClient, type OpenAICompatibleClient } from "./tauri-client";

/**
 * 获取当前的prompt内容
 */
export async function getPromptContent(): Promise<string> {
  const store = await Store.load('store.json')
  const currentPromptId = await store.get<string>('currentPromptId')
  let promptContent = ''
  
  if (currentPromptId) {
    const promptList = await store.get<Array<{id: string, content: string}>>('promptList')
    if (promptList) {
      const currentPrompt = promptList.find(prompt => prompt.id === currentPromptId)
      if (currentPrompt && currentPrompt.content) {
        promptContent = currentPrompt.content
      }
    }
  }
  
  return promptContent
}

/**
 * 获取AI设置
 */
export async function getAISettings(modelType?: string): Promise<AiConfig | undefined> {
  const store = await Store.load('store.json')
  const aiConfigs = await store.get<AiConfig[]>('aiModelList')
  const modelId = await store.get(modelType || 'primaryModel')

  if (!modelId || !aiConfigs) {
    return undefined
  }

  // 在新的数据结构中，需要找到包含指定模型ID的配置
  for (const config of aiConfigs) {
    // 检查新的 models 数组结构
    if (config.models && config.models.length > 0) {
      // 首先尝试直接匹配模型ID
      let targetModel = config.models.find(model => model.id === modelId)

      // 如果没找到，尝试匹配组合键格式 ${config.key}-${model.id}
      if (!targetModel && typeof modelId === 'string' && modelId.includes('-')) {
        const expectedPrefix = `${config.key}-`
        if (modelId.startsWith(expectedPrefix)) {
          const originalModelId = modelId.substring(expectedPrefix.length)
          targetModel = config.models.find(model => model.id === originalModelId)
        }
      }

      if (targetModel) {
        const result = {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        }
        return result
      }
    } else {
      // 向后兼容：处理旧的单模型结构
      if (config.key === modelId) {
        return config
      }
    }
  }

  return undefined
}

/**
 * 检查AI服务配置是否有效
 */
export async function validateAIService(baseURL: string | undefined): Promise<string | null> {
  if (!baseURL) {
    toast({
      title: 'AI 错误',
      description: '请先设置 AI 地址',
      variant: 'destructive',
    })
    return null
  }
  return baseURL
}

/**
 * 将图片 URL 转换为 base64 格式
 */
export async function convertImageToBase64(imageUrl: string): Promise<string | null> {
  try {
    // 如果已经是 base64 格式，直接返回
    if (imageUrl.startsWith('data:image')) {
      return imageUrl
    }

    // 从 convertFileSrc 生成的 URL 中提取文件路径
    let filePath = imageUrl

    try {
      const url = new URL(imageUrl)
      filePath = decodeURIComponent(url.pathname)
      if (platform() === 'windows' && filePath.startsWith('/')) {
        filePath = filePath.substring(1)
      }
    } catch {
      filePath = imageUrl
    }

    // 读取文件
    const fileData = await readFile(filePath)

    // 转换为 base64
    const base64 = btoa(
      new Uint8Array(fileData).reduce((data, byte) => data + String.fromCharCode(byte), '')
    )

    // 根据文件扩展名确定 MIME 类型
    let mimeType = 'image/png'
    if (filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')) {
      mimeType = 'image/jpeg'
    } else if (filePath.toLowerCase().endsWith('.gif')) {
      mimeType = 'image/gif'
    } else if (filePath.toLowerCase().endsWith('.webp')) {
      mimeType = 'image/webp'
    }

    return `data:${mimeType};base64,${base64}`
  } catch (error) {
    console.error('Failed to convert image to base64:', error)
    return null
  }
}

/**
 * 处理AI请求错误
 */
export function handleAIError(error: any, showToast = true): string | null {
  const errorMessage = error instanceof Error ? error.message : '未知错误'
  // 检查是否是取消请求的错误，如果是则静默处理
  if (error.message === 'Request was aborted.') {
    // 静默处理取消请求，不显示任何消息
    return null
  }
  
  if (showToast) {
    toast({
      description: errorMessage || 'AI错误',
      variant: 'destructive',
    })
  }
  
  return `请求失败: ${errorMessage}`
}

/**
 * 为不同AI类型准备消息
 * @param text 用户输入文本（如果提供了 baseMessages，此参数将作为最后一条用户消息）
 * @param baseMessages 基础消息数组（如对话历史），如果提供，将合并到返回结果中
 */
export async function prepareMessages(
  text: string,
  baseMessages?: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<{
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  geminiText?: string
}> {
  // 获取prompt内容
  let promptContent = await getPromptContent()

  // 加载记忆上下文
  try {
    const { contextLoader } = await import('@/lib/context/loader')
    // 确定用于检索记忆的查询文本
    let queryText = text || ''
    if (baseMessages && baseMessages.length > 0) {
      // 如果提供了消息数组，使用最后一条用户消息作为查询
      const lastUserMessage = [...baseMessages].reverse().find(m => m.role === 'user')
      if (lastUserMessage) {
        queryText = typeof lastUserMessage.content === 'string' ? lastUserMessage.content : queryText
      }
    }

    if (queryText) {
      const memoryContext = await contextLoader.getContextForQuery(queryText)
      if (memoryContext.preferences.length > 0 || memoryContext.memory.length > 0) {
        const memoryPrompt = contextLoader.formatMemoriesForPrompt(memoryContext)
        promptContent += '\n\n' + memoryPrompt
      }
    }
  } catch (error) {
    // 如果记忆加载失败，不影响正常对话
    console.error('Failed to load memory context:', error)
  }

  // 如果提供了基础消息数组，直接使用它
  if (baseMessages && baseMessages.length > 0) {
    // 检查是否已经有 system 消息
    const hasSystemMessage = baseMessages.some(msg => msg.role === 'system')

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

    // 如果需要添加 system prompt 且当前没有 system 消息
    if (promptContent && !hasSystemMessage) {
      messages.push({
        role: 'system',
        content: promptContent
      })
    }

    // 添加所有基础消息
    messages.push(...baseMessages)

    // 添加系统提示词（如果有且原消息中没有）
    if (promptContent && hasSystemMessage) {
      // 如果已有 system 消息，合并内容
      const firstSystemIndex = messages.findIndex(msg => msg.role === 'system')
      if (firstSystemIndex !== -1) {
        const existingContent = typeof messages[firstSystemIndex].content === 'string'
          ? messages[firstSystemIndex].content
          : ''
        messages[firstSystemIndex] = {
          role: 'system',
          content: existingContent + '\n\n' + promptContent
        }
      }
    }

    return { messages, geminiText: undefined }
  }

  // 定义消息数组（旧逻辑，保持向后兼容）
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let geminiText: string | undefined

  if (promptContent) {
    messages.push({
      role: 'system',
      content: promptContent
    })
  }

  messages.push({
    role: 'user',
    content: text
  })

  return { messages, geminiText }
}

/**
 * 创建OpenAI客户端，适用于所有AI类型
 */
export async function createOpenAIClient(AiConfig?: AiConfig): Promise<OpenAICompatibleClient> {
  const store = await Store.load('store.json')

  if (AiConfig) {
    return createTauriOpenAIClient(AiConfig)
  }

  const baseURL = await store.get<string>('baseURL')
  const apiKey = await store.get<string>('apiKey')

  return createTauriOpenAIClient({
    key: 'runtime',
    title: 'Runtime',
    baseURL,
    apiKey,
  })
}
