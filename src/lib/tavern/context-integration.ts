/**
 * Context Integration - 上下文构建集成层
 * 
 * 提供统一的接口构建上下文
 * 支持所有扩展功能的集成
 */

import {
  TavernCard,
  TavernMessage,
  TavernPersona,
  type TavernSysPrompt,
} from '@/db/tavern'
import { ContextBuilderV2, ContextBuildResultV2, ExtensionPrompt, AIMessage, estimateTokens } from './context-builder-v2'
import { useTavernMemoryStore } from '@/stores/tavern-memory'
import { useTavernVectorsStore } from '@/stores/tavern-vectors'
import { useTavernAuthorsNoteStore, AuthorsNotePosition, AuthorsNoteConfig } from '@/stores/tavern-authors-note'
import { usePromptManagerStore } from '@/stores/tavern-prompt-manager'
import { useTavernSysPromptStore, getEffectiveSystemPrompt, getEffectivePostHistory } from '@/stores/tavern-sysprompt'

// ============ 类型定义 ============

/**
 * 上下文构建选项
 */
export interface ContextBuildOptions {
  // 基础选项
  maxContext?: number
  maxResponse?: number
  
  // 功能开关
  includeExamples?: boolean
  includeWorldInfo?: boolean
  
  // 扩展功能 - 使用原生 AuthorsNoteConfig 类型
  authorsNote?: AuthorsNoteConfig | null
  
  // SysPrompt - 系统提示词预设
  sysPrompt?: TavernSysPrompt | null
  
  // 群聊
  isGroupChat?: boolean
  groupMembers?: string[]
  
  // Custom Stopping Strings (ST 兼容)
  customStoppingStrings?: string[]
  useStopStrings?: boolean
  
  // 调试
  enableLogging?: boolean
}

/**
 * 统一的构建结果
 */
export interface UnifiedBuildResult {
  messages: AIMessage[]
  tokenCount: number
  worldInfoStats?: {
    totalScanned: number
    totalActivated: number
    tokensUsed: number
  }
  // Custom Stopping Strings (ST 兼容)
  stopSequences?: string[]
}

// ============ 辅助函数 ============

/**
 * 解析 ST 格式的停止字符串
 * ST 格式是 JSON 数组字符串，例如: '["\\n", "\\nUser:"]'
 */
export function parseStoppingStrings(jsonString?: string): string[] {
  if (!jsonString) return []
  try {
    const parsed = JSON.parse(jsonString)
    if (Array.isArray(parsed)) {
      return parsed.filter(s => typeof s === 'string')
    }
  } catch {
    // 解析失败，返回空数组
  }
  return []
}

/**
 * 将 AuthorsNotePosition 转换为 ExtensionPrompt 的 position
 */
function convertPosition(position: AuthorsNotePosition): 'before' | 'after' | 'in_chat' {
  switch (position) {
    case AuthorsNotePosition.BeforeScenario:
      return 'before'
    case AuthorsNotePosition.AfterScenario:
      return 'after'
    case AuthorsNotePosition.InChat:
      return 'in_chat'
    default:
      return 'after'
  }
}

// ============ 集成函数 ============

/**
 * 收集扩展提示词
 */
export function collectExtensionPrompts(
  cardId: number,
  chatId?: number
): Record<string, ExtensionPrompt> {
  const prompts: Record<string, ExtensionPrompt> = {}
  
  // 1. Memory/Summary
  try {
    const memoryStore = useTavernMemoryStore.getState()
    if (chatId) {
      const summary = memoryStore.getCombinedSummary(chatId)
      if (summary) {
        prompts['1_memory'] = {
          identifier: '1_memory',
          value: summary,
          position: 'before',
        }
      }
    }
  } catch (e) {
    console.warn('Failed to get memory:', e)
  }
  
  // 2. Author's Note
  try {
    const anStore = useTavernAuthorsNoteStore.getState()
    const anConfig = anStore.getEffectiveConfig(cardId, chatId)
    if (anConfig.enabled && anConfig.content) {
      prompts['2_floating_prompt'] = {
        identifier: '2_floating_prompt',
        value: anConfig.content,
        position: convertPosition(anConfig.position),
        depth: anConfig.depth,
        role: anConfig.role,
      }
    }
  } catch (e) {
    console.warn('Failed to get authors note:', e)
  }
  
  // 3. Vectors/RAG Memory - 从 store 获取当前搜索结果
  try {
    const vectorsStore = useTavernVectorsStore.getState()
    if (vectorsStore.config.enabled && vectorsStore.currentResults.length > 0) {
      const vectorMemory = vectorsStore.buildContextString()
      if (vectorMemory) {
        prompts['3_vectors'] = {
          identifier: '3_vectors',
          value: vectorMemory,
          position: 'before',
        }
      }
    }
  } catch (e) {
    console.warn('Failed to get vectors memory:', e)
  }
  
  return prompts
}

/**
 * 构建上下文
 */
export async function buildTavernContext(
  card: TavernCard,
  persona: TavernPersona,
  messages: TavernMessage[],
  userInput?: string,
  options: ContextBuildOptions = {}
): Promise<UnifiedBuildResult> {
  // 收集扩展提示词
  const extensionPrompts = collectExtensionPrompts(card.id, messages[0]?.chatId)
  
  // 如果有传入的 authorsNote，覆盖收集的
  if (options.authorsNote?.enabled && options.authorsNote.content) {
    extensionPrompts['2_floating_prompt'] = {
      identifier: '2_floating_prompt',
      value: options.authorsNote.content,
      position: convertPosition(options.authorsNote.position),
      depth: options.authorsNote.depth,
      role: options.authorsNote.role,
    }
  }
  
  // 获取 SysPrompt (优先使用传入的，否则从 store 获取)
  let sysPrompt = options.sysPrompt
  if (sysPrompt === undefined) {
    sysPrompt = useTavernSysPromptStore.getState().getEnabled()
  }
  
  // 计算有效的系统提示词和 jailbreak
  const effectiveSystemPrompt = getEffectiveSystemPrompt(card.systemPrompt || '', sysPrompt)
  const effectivePostHistory = getEffectivePostHistory(card.postHistoryInstructions || '', sysPrompt)
  
  // 创建 V2 构建器
  const builder = new ContextBuilderV2(card, persona, {
    maxContext: options.maxContext ?? 8192,
    maxResponse: options.maxResponse ?? 1024,
    includeExamples: options.includeExamples ?? true,
    includeWorldInfo: options.includeWorldInfo ?? true,
    isGroupChat: options.isGroupChat ?? false,
    groupMembers: options.groupMembers,
    extensionPrompts,
    // SysPrompt 覆盖
    systemPromptOverride: sysPrompt ? effectiveSystemPrompt : undefined,
    jailbreakOverride: sysPrompt && sysPrompt.postHistory ? effectivePostHistory : undefined,
    enableLogging: options.enableLogging,
  })
  
  // 构建上下文
  const result = await builder.build(messages, userInput)
  
  // 处理停止字符串
  let stopSequences: string[] | undefined
  if (options.useStopStrings !== false && options.customStoppingStrings?.length) {
    stopSequences = options.customStoppingStrings
  }
  
  return {
    messages: result.messages,
    tokenCount: result.tokenCount,
    worldInfoStats: result.worldInfoResult?.stats,
    stopSequences,
  }
}

/**
 * 统一的上下文构建函数 (buildTavernContext 的别名)
 */
export const buildUnifiedContext = buildTavernContext

/**
 * 获取 Prompt Manager 配置的提示词顺序
 */
export function getPromptOrder(): string[] {
  try {
    const store = usePromptManagerStore.getState()
    return store.getActivePromptOrder()
      .filter(e => e.enabled)
      .map(e => e.identifier)
  } catch {
    return [
      'main',
      'worldInfoBefore',
      'charDescription',
      'charPersonality',
      'scenario',
      'personaDescription',
      'worldInfoAfter',
      'dialogueExamples',
      'chatHistory',
      'jailbreak',
    ]
  }
}

