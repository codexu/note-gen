import {
  inspectChatImage,
  type ImageInspectionCrop,
} from '@/lib/chat-image-context'
import type { AgentTool } from '../types'

const imageInspectTool: AgentTool = {
  name: 'image_inspect',
  title: '深入识别图片',
  description: 'Inspect a user-uploaded image again when persisted OCR or visual context is insufficient. Use the exact imageId from Available image attachments. The optional crop uses normalized 0-1 coordinates.',
  category: 'image',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      imageId: {
        type: 'string',
        description: 'Exact image ID from the current image attachment context.',
      },
      prompt: {
        type: 'string',
        description: 'Focused question about the image. Include the exact detail that must be inspected.',
      },
      crop: {
        type: 'object',
        description: 'Optional normalized crop rectangle. x, y, width, and height are numbers from 0 to 1.',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
        required: ['x', 'y', 'width', 'height'],
        additionalProperties: false,
      },
    },
    required: ['imageId', 'prompt'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const imageId = typeof input.imageId === 'string' ? input.imageId : ''
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    const attachment = context.context.imageAttachments?.find(image => image.imageId === imageId)
    if (!attachment) {
      return {
        ok: false,
        message: '图片不存在或已不在本轮可访问范围内。',
        error: 'IMAGE_ATTACHMENT_NOT_AVAILABLE',
      }
    }
    if (!prompt) {
      return {
        ok: false,
        message: '必须提供明确的图片检查问题。',
        error: 'IMAGE_INSPECTION_PROMPT_REQUIRED',
      }
    }

    const cropValue = input.crop
    const crop = cropValue && typeof cropValue === 'object' && !Array.isArray(cropValue)
      ? cropValue as Partial<ImageInspectionCrop>
      : undefined
    const validCrop = crop
      && [crop.x, crop.y, crop.width, crop.height].every(value => typeof value === 'number')
      ? crop as ImageInspectionCrop
      : undefined

    try {
      const result = await inspectChatImage(
        {
          id: attachment.imageId,
          url: attachment.sourceUrl,
          name: attachment.name,
        },
        prompt,
        context.signal,
        validCrop
      )
      if (result.status !== 'completed') {
        return {
          ok: false,
          message: '图片重新识别未返回有效内容。',
          data: result,
          error: result.errorCode || 'IMAGE_INSPECTION_FAILED',
        }
      }
      return {
        ok: true,
        message: `已重新识别图片 ${attachment.name}。`,
        data: {
          imageId: result.imageId,
          name: result.name,
          method: result.method,
          crop: validCrop,
          ocrText: result.ocrText,
          visualAnalysis: result.visualAnalysis,
        },
      }
    } catch (error) {
      return {
        ok: false,
        message: `图片重新识别失败：${String(error)}`,
        error: 'IMAGE_INSPECTION_FAILED',
      }
    }
  },
}

export const imageTools = [imageInspectTool]
