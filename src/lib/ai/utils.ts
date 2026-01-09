import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import OpenAI from 'openai';
import { AiConfig } from "@/app/core/setting/config";
import { readFile } from "@tauri-apps/plugin-fs";

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
        // 返回合并了模型配置的 AiConfig
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        }
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
    
    // 从 Tauri URL 中提取文件路径
    // convertFileSrc 生成的 URL 格式类似: tauri://localhost/path 或 asset://localhost/path
    let filePath = imageUrl
    
    // 移除 tauri:// 或 asset:// 协议前缀
    if (imageUrl.startsWith('tauri://localhost/')) {
      filePath = imageUrl.replace('tauri://localhost/', '')
    } else if (imageUrl.startsWith('asset://localhost/')) {
      filePath = imageUrl.replace('asset://localhost/', '')
    } else if (imageUrl.startsWith('http://tauri.localhost/')) {
      filePath = imageUrl.replace('http://tauri.localhost/', '')
    }
    
    // URL 解码
    filePath = decodeURIComponent(filePath)
    
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
 */
export async function prepareMessages(text: string, includeLanguage = false): Promise<{
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  geminiText?: string
}> {
  // 获取prompt内容
  let promptContent = await getPromptContent()
  
  if (includeLanguage) {
    const store = await Store.load('store.json')
    const chatLanguage = await store.get<string>('chatLanguage') || 'English'
    promptContent += '\n\n' + `IMPORTANT: You MUST respond in ${chatLanguage} language. Do NOT use any other language under any circumstances.`
  }
  
  // 定义消息数组
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
export async function createOpenAIClient(AiConfig?: AiConfig) {
  const store = await Store.load('store.json')
  let baseURL
  let apiKey
  if (AiConfig) {
    baseURL = AiConfig.baseURL
    apiKey = AiConfig.apiKey
  } else {
    baseURL = await store.get<string>('baseURL')
    apiKey = await store.get<string>('apiKey')
  }
  const proxyUrl = await store.get<string>('proxy')
  
  // 创建OpenAI客户端
  return new OpenAI({
    apiKey: apiKey || '',
    baseURL: baseURL,
    dangerouslyAllowBrowser: true,
    defaultHeaders:{
      "x-stainless-arch": null,
      "x-stainless-lang": null,
      "x-stainless-os": null,
      "x-stainless-package-version": null,
      "x-stainless-retry-count": null,
      "x-stainless-runtime": null,
      "x-stainless-runtime-version": null,
      "x-stainless-timeout": null,
      ...(AiConfig?.customHeaders || {})
    },
    ...(proxyUrl ? { httpAgent: proxyUrl } : {})
  })
}
