/**
 * 翻译服务
 * 使用 AI 后端进行实时翻译
 */

import { useTavernTranslateStore, SUPPORTED_LANGUAGES, LanguageCode } from '@/stores/tavern-translate'
import { AIMessage } from './context-builder-v2'

// 获取语言名称
export function getLanguageName(code: LanguageCode | 'auto'): string {
  if (code === 'auto') return '自动检测'
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code)
  return lang?.name || code
}

// 构建翻译提示词
export function buildTranslatePrompt(
  text: string,
  sourceLang: string,
  targetLang: string,
  options: {
    preserveFormatting?: boolean
    preserveNames?: boolean
    customPrompt?: string
  } = {}
): AIMessage[] {
  const { preserveFormatting = true, preserveNames = true, customPrompt } = options
  
  const sourceDisplay = sourceLang === 'auto' ? '原文语言' : getLanguageName(sourceLang as LanguageCode)
  const targetDisplay = getLanguageName(targetLang as LanguageCode)
  
  let systemPrompt = `你是一个专业的翻译助手。请将用户提供的文本从${sourceDisplay}翻译成${targetDisplay}。`
  
  if (preserveFormatting) {
    systemPrompt += '\n- 保留原文的格式，包括换行、段落和标点符号'
  }
  
  if (preserveNames) {
    systemPrompt += '\n- 保留人名、角色名和专有名词不翻译'
  }
  
  systemPrompt += '\n- 只输出翻译结果，不要添加任何解释或注释'
  
  if (customPrompt) {
    systemPrompt += `\n\n额外要求：${customPrompt}`
  }
  
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: text },
  ]
}

// 翻译结果
export interface TranslateResult {
  success: boolean
  translated?: string
  error?: string
  fromCache?: boolean
}

// 执行翻译
export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  options: {
    preserveFormatting?: boolean
    preserveNames?: boolean
    customPrompt?: string
    onProgress?: (content: string) => void
  } = {}
): Promise<TranslateResult> {
  const store = useTavernTranslateStore.getState()
  
  // 检查缓存
  const cached = store.getCachedTranslation(text, sourceLang, targetLang)
  if (cached) {
    return { success: true, translated: cached, fromCache: true }
  }
  
  try {
    // 构建提示词
    const messages = buildTranslatePrompt(text, sourceLang, targetLang, options)
    
    // 使用 AI 服务
    const { streamTavernResponse, checkAIServiceAvailable } = await import('./ai-service')
    
    const isAvailable = await checkAIServiceAvailable()
    if (!isAvailable) {
      return { success: false, error: 'AI 服务不可用' }
    }
    
    let translated = ''
    
    await streamTavernResponse(
      messages,
      (content: string) => {
        translated = content
        options.onProgress?.(content)
      },
      undefined,
      {
        temperature: 0.1, // 低温度以获得更准确的翻译
        maxTokens: Math.max(text.length * 2, 500), // 翻译通常不会比原文长太多
      }
    )
    
    if (!translated) {
      return { success: false, error: '翻译失败' }
    }
    
    // 缓存结果
    store.setCachedTranslation(text, translated, sourceLang, targetLang)
    
    return { success: true, translated }
  } catch (error) {
    console.error('翻译失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

// 翻译用户输入
export async function translateInput(
  text: string,
  cardId?: number,
  onProgress?: (content: string) => void
): Promise<TranslateResult> {
  const store = useTavernTranslateStore.getState()
  const config = store.getEffectiveConfig(cardId)
  
  if (!store.shouldTranslateInput(cardId)) {
    return { success: true, translated: text }
  }
  
  return translateText(
    text,
    config.inputSourceLang,
    config.inputTargetLang,
    {
      preserveFormatting: config.preserveFormatting,
      preserveNames: config.preserveNames,
      customPrompt: config.customPrompt,
      onProgress,
    }
  )
}

// 翻译 AI 输出
export async function translateOutput(
  text: string,
  cardId?: number,
  onProgress?: (content: string) => void
): Promise<TranslateResult> {
  const store = useTavernTranslateStore.getState()
  const config = store.getEffectiveConfig(cardId)
  
  if (!store.shouldTranslateOutput(cardId)) {
    return { success: true, translated: text }
  }
  
  return translateText(
    text,
    config.outputSourceLang,
    config.outputTargetLang,
    {
      preserveFormatting: config.preserveFormatting,
      preserveNames: config.preserveNames,
      customPrompt: config.customPrompt,
      onProgress,
    }
  )
}

// 检测语言 (简单实现)
export function detectLanguage(text: string): LanguageCode {
  // 简单的语言检测
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const japaneseChars = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length
  const koreanChars = (text.match(/[\uac00-\ud7af]/g) || []).length
  const cyrillicChars = (text.match(/[\u0400-\u04ff]/g) || []).length
  
  const totalChars = text.length
  
  if (chineseChars / totalChars > 0.3) return 'zh'
  if (japaneseChars / totalChars > 0.1) return 'ja'
  if (koreanChars / totalChars > 0.1) return 'ko'
  if (cyrillicChars / totalChars > 0.3) return 'ru'
  
  // 默认英语
  return 'en'
}
