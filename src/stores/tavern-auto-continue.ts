/**
 * Tavern Auto Continue Store
 * 自动继续生成功能
 * 
 * 当 AI 生成的回复长度不足目标时，自动触发继续生成
 * 对齐 SillyTavern power_user.auto_continue
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Auto Continue 配置
 */
export interface AutoContinueConfig {
  /** 是否启用自动继续 */
  enabled: boolean
  /** 是否允许 Chat Completions API 使用 (部分 API 不支持 continue) */
  allowChatCompletions: boolean
  /** 目标长度 (字符数) */
  targetLength: number
  /** 最大继续次数 (防止无限循环) */
  maxContinues: number
}

interface AutoContinueState extends AutoContinueConfig {
  /** 更新配置 */
  updateConfig: (config: Partial<AutoContinueConfig>) => void
  /** 重置为默认 */
  reset: () => void
}

/**
 * 默认配置
 */
const defaultConfig: AutoContinueConfig = {
  enabled: false,
  allowChatCompletions: false,
  targetLength: 400,
  maxContinues: 5,
}

export const useTavernAutoContinueStore = create<AutoContinueState>()(
  persist(
    (set) => ({
      ...defaultConfig,

      updateConfig: (config) => {
        set(config)
      },

      reset: () => {
        set(defaultConfig)
      },
    }),
    {
      name: 'tavern-auto-continue',
    }
  )
)

// ============ 辅助函数 ============

/**
 * 获取当前配置 (非响应式)
 */
export function getAutoContinueConfig(): AutoContinueConfig {
  return useTavernAutoContinueStore.getState()
}

/**
 * 检查是否应该自动继续
 * @param responseLength 当前响应长度 (字符数)
 * @param continueCount 已继续次数
 * @param isChatCompletion 是否是 Chat Completion API
 */
export function shouldAutoContinue(
  responseLength: number,
  continueCount: number,
  isChatCompletion: boolean = false
): boolean {
  const config = getAutoContinueConfig()
  
  if (!config.enabled) {
    return false
  }
  
  // 检查 Chat Completion 限制
  if (isChatCompletion && !config.allowChatCompletions) {
    return false
  }
  
  // 检查最大继续次数
  if (continueCount >= config.maxContinues) {
    return false
  }
  
  // 检查长度是否不足
  return responseLength < config.targetLength
}

/**
 * 估算文本长度 (考虑中英文差异)
 * 中文字符权重更高
 */
export function estimateTextLength(text: string): number {
  if (!text) return 0
  
  // 计算中文字符
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  // 其他字符
  const otherChars = text.length - chineseChars
  
  // 中文字符按 1.5 倍计算 (因为信息密度更高)
  return Math.round(chineseChars * 1.5 + otherChars)
}

/**
 * 检查响应是否完整结束
 * 用于判断是否需要继续生成
 */
export function isResponseComplete(text: string): boolean {
  if (!text) return false
  
  const trimmed = text.trim()
  if (!trimmed) return false
  
  // 检查是否以完整的句子结束
  const endMarkers = [
    // 中文标点
    '。', '！', '？', '」', '』', '】', '）', '"', "'",
    // 英文标点
    '.', '!', '?', '"', "'", ')', ']', '}',
    // 特殊结束
    '…', '——', '--',
  ]
  
  const lastChar = trimmed[trimmed.length - 1]
  return endMarkers.includes(lastChar)
}

/**
 * 合并继续生成的文本
 * @param original 原始文本
 * @param continuation 继续生成的文本
 */
export function mergeContinuation(original: string, continuation: string): string {
  if (!continuation) return original
  if (!original) return continuation
  
  // 去除 continuation 开头可能的重复部分
  // 有些模型可能会重复最后几个字
  const overlapLength = Math.min(20, original.length)
  const originalEnd = original.slice(-overlapLength)
  
  let cleanContinuation = continuation
  
  // 检查是否有重叠
  for (let i = overlapLength; i > 0; i--) {
    const overlap = originalEnd.slice(-i)
    if (continuation.startsWith(overlap)) {
      cleanContinuation = continuation.slice(i)
      break
    }
  }
  
  // 确保连接处有适当的空格/换行
  const needsSpace = (
    /[a-zA-Z0-9]$/.test(original) && 
    /^[a-zA-Z0-9]/.test(cleanContinuation)
  )
  
  return original + (needsSpace ? ' ' : '') + cleanContinuation
}
