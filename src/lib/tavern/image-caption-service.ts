/**
 * 图片描述服务
 * 使用多模态 AI 生成图片描述
 * 调用 Note 的 imageMethodModel 配置
 */

import { useTavernImageCaptionStore, ImageAttachment, ImageCaptionConfig } from '@/stores/tavern-image-caption'
import { getAISettings, createOpenAIClient, validateAIService } from '@/lib/ai/utils'
import OpenAI from 'openai'

// 图片描述结果
export interface CaptionResult {
  success: boolean
  caption?: string
  error?: string
}

// 根据详细程度获取提示词
export function getCaptionPrompt(config: ImageCaptionConfig): string {
  switch (config.detailLevel) {
    case 'low':
      return '请简要描述这张图片的主要内容。'
    case 'high':
      return `${config.captionPrompt}\n\n请尽可能详细地描述，包括：
- 场景和背景
- 人物的外貌、表情、动作、服装
- 物体的位置、颜色、材质
- 光线、氛围、情绪
- 任何文字或符号`
    default:
      return config.captionPrompt
  }
}

// 生成图片描述 - 使用 Note 的 imageMethodModel
export async function generateCaption(
  image: ImageAttachment,
  config: ImageCaptionConfig,
  onProgress?: (content: string) => void
): Promise<CaptionResult> {
  try {
    // 获取图片数据
    const imageDataUrl = image.dataUrl
    if (!imageDataUrl) {
      return { success: false, error: '图片数据不可用' }
    }
    
    // 获取图像识别模型配置 (Note 的 imageMethodModel)
    const aiConfig = await getAISettings('imageMethodModel')
    
    if (!aiConfig) {
      return { success: false, error: '未配置图像识别模型，请在设置中配置' }
    }
    
    // 验证 AI 服务
    if (await validateAIService(aiConfig.baseURL) === null) {
      return { success: false, error: 'AI 服务不可用' }
    }
    
    // 创建 OpenAI 客户端
    const openai = await createOpenAIClient(aiConfig)
    
    // 获取提示词
    const prompt = getCaptionPrompt(config)
    
    // 构建多模态消息
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ]
    
    // 流式请求
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.3,
      max_tokens: config.maxTokens,
      stream: true,
    })
    
    let caption = ''
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        caption += content
        onProgress?.(caption)
      }
    }
    
    if (!caption) {
      return { success: false, error: '描述生成失败' }
    }
    
    return { success: true, caption }
  } catch (error) {
    console.error('生成图片描述失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

// 从文件创建图片附件
export async function createImageAttachment(file: File): Promise<ImageAttachment | null> {
  try {
    // 读取文件为 Data URL
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    
    // 获取图片尺寸
    const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.width, height: img.height })
      img.onerror = () => resolve({ width: 0, height: 0 })
      img.src = dataUrl
    })
    
    // 生成缩略图
    const thumbnailDataUrl = await generateThumbnail(dataUrl, 150)
    
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      filename: file.name,
      path: '',
      dataUrl,
      mimeType: file.type,
      size: file.size,
      width: dimensions.width,
      height: dimensions.height,
      thumbnailDataUrl,
    }
  } catch (error) {
    console.error('创建图片附件失败:', error)
    return null
  }
}

// 生成缩略图
export async function generateThumbnail(
  dataUrl: string,
  maxSize: number
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      
      // 计算缩略图尺寸
      let width = img.width
      let height = img.height
      
      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width
          width = maxSize
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height
          height = maxSize
        }
      }
      
      canvas.width = width
      canvas.height = height
      
      ctx.drawImage(img, 0, 0, width, height)
      
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// 格式化图片描述为上下文
export function formatCaptionForContext(
  caption: string,
  template: string
): string {
  return template.replace('{{caption}}', caption)
}

// 从剪贴板获取图片
export async function getImageFromClipboard(): Promise<ImageAttachment | null> {
  try {
    const items = await navigator.clipboard.read()
    
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type)
          const file = new File([blob], `clipboard-${Date.now()}.png`, { type })
          return createImageAttachment(file)
        }
      }
    }
    
    return null
  } catch (error) {
    console.error('从剪贴板获取图片失败:', error)
    return null
  }
}
