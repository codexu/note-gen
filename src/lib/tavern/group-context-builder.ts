/**
 * Group Context Builder - 群聊上下文构建器
 * 
 * 基于 ContextBuilderV2 为群聊提供专门的上下文构建支持:
 * - 角色信息模式 (单一/联合/联合排除静音)
 * - 场景覆盖
 * - SysPrompt 集成
 * - 世界书/Author's Note/Persona 集成
 * - 群聊历史格式化 (带名称前缀)
 */

import {
  TavernCard,
  TavernMessage,
  TavernPersona,
  TavernGroup,
  TavernGroupMember,
  GroupCharacterMode,
  TavernWorldInfoEntry,
  getWorldInfos,
  getWorldInfoEntries,
  getWorldInfoByName,
} from '@/db/tavern'
import { AIMessage } from './context-builder-v2'
import { TavernTemplateEngine } from './template-engine'
import { WorldInfoScanner, WorldInfoScanResult, createTimedEffectsState } from './world-info-scanner'
import { getPersonaInjection } from './persona-injection'
import { useTavernSysPromptStore, getEffectiveSystemPrompt, getEffectivePostHistory } from '@/stores/tavern-sysprompt'
import { useTavernAuthorsNoteStore, AuthorsNotePosition } from '@/stores/tavern-authors-note'

// ============ 类型定义 ============

/**
 * 群聊成员（包含角色卡信息）
 */
export type GroupMemberWithCard = TavernGroupMember & TavernCard

/**
 * 群聊上下文构建配置
 */
export interface GroupContextConfig {
  // Token 预算
  maxContext: number
  maxResponse: number
  
  // 功能开关
  includeWorldInfo: boolean
  includeAuthorsNote: boolean
  
  // 调试
  enableLogging?: boolean
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: GroupContextConfig = {
  maxContext: 8192,
  maxResponse: 1024,
  includeWorldInfo: true,
  includeAuthorsNote: true,
}

/**
 * 群聊上下文构建结果
 */
export interface GroupContextResult {
  messages: AIMessage[]
  tokenCount: number
  worldInfoResult?: WorldInfoScanResult
}

// ============ 核心函数 ============

/**
 * 构建联合角色信息提示词
 * 将多个角色的信息合并成一个联合提示词
 */
export function buildJointCharacterPrompt(
  members: GroupMemberWithCard[],
  group: TavernGroup,
  persona: TavernPersona,
  currentSpeaker?: GroupMemberWithCard
): string {
  const parts: string[] = []
  
  // 1. 群聊介绍
  parts.push(`[Group Chat: ${group.name}]`)
  parts.push(`Members: ${members.map(m => m.name).join(', ')}`)
  if (group.description) {
    parts.push(`Description: ${group.description}`)
  }
  parts.push('')
  
  // 2. 场景 (使用覆盖或合并)
  if (group.scenarioOverride) {
    parts.push(`[Scenario]`)
    parts.push(group.scenarioOverride)
    parts.push('')
  }
  
  // 3. 每个成员的角色信息
  for (const member of members) {
    const templateEngine = TavernTemplateEngine.fromCardAndPersona(member, persona)
    const isCurrent = currentSpeaker && member.cardId === currentSpeaker.cardId
    
    parts.push(`[Character: ${member.name}]${isCurrent ? ' (Current Speaker)' : ''}`)
    
    if (member.description) {
      parts.push(`Description: ${templateEngine.process(member.description)}`)
    }
    if (member.personality) {
      parts.push(`Personality: ${templateEngine.process(member.personality)}`)
    }
    // 只有在没有场景覆盖时才显示角色场景
    if (!group.scenarioOverride && member.scenario) {
      parts.push(`Scenario: ${templateEngine.process(member.scenario)}`)
    }
    parts.push('')
  }
  
  return parts.join('\n').trim()
}

/**
 * 格式化群聊历史消息
 * 添加角色名称前缀，便于 AI 区分发言者
 */
export function formatGroupChatHistory(
  messages: TavernMessage[],
  userName: string
): AIMessage[] {
  return messages
    .filter(m => !m.isHidden)
    .map(msg => {
      const name = msg.role === 'user' ? userName : msg.name
      const content = msg.role === 'system' 
        ? msg.content 
        : `[${name}]: ${msg.content}`
      
      return {
        role: msg.role as 'user' | 'assistant' | 'system',
        content,
        name: msg.name,
      }
    })
}

/**
 * 扫描世界书
 */
async function scanWorldInfo(
  members: GroupMemberWithCard[],
  messages: TavernMessage[],
  persona: TavernPersona,
  userInput?: string
): Promise<{ entries: TavernWorldInfoEntry[], result: WorldInfoScanResult }> {
  const allEntries: TavernWorldInfoEntry[] = []
  
  try {
    // 加载全局世界书
    const globalWI = await getWorldInfos('global')
    for (const wi of globalWI) {
      if (wi.enabled) {
        const entries = await getWorldInfoEntries(wi.id)
        allEntries.push(...entries.filter(e => e.enabled))
      }
    }
    
    // 加载所有成员的角色世界书
    for (const member of members) {
      const charWI = await getWorldInfos('character', member.cardId)
      for (const wi of charWI) {
        if (wi.enabled) {
          const entries = await getWorldInfoEntries(wi.id)
          allEntries.push(...entries.filter(e => e.enabled))
        }
      }
    }
    
    // 加载 Persona 关联世界书
    if (persona.lorebook) {
      const personaWI = await getWorldInfoByName(persona.lorebook)
      if (personaWI && personaWI.enabled) {
        const entries = await getWorldInfoEntries(personaWI.id)
        allEntries.push(...entries.filter(e => e.enabled))
      }
    }
  } catch (e) {
    console.warn('Failed to load world info for group chat:', e)
  }
  
  if (allEntries.length === 0) {
    return {
      entries: [],
      result: {
        activatedEntries: [],
        contentBefore: '',
        contentAfter: '',
        depthContent: new Map(),
        resolvedContent: new Map(),
        stats: {
          totalScanned: 0,
          totalActivated: 0,
          recursionSteps: 0,
          tokensUsed: 0,
          referencesResolved: 0,
          conditionsChecked: 0,
        },
      }
    }
  }
  
  // 扫描
  const scanner = new WorldInfoScanner(
    allEntries,
    { scanDepth: 10 },
    createTimedEffectsState(),
    messages.length
  )
  
  const texts = messages.map(m => m.content)
  if (userInput) texts.push(userInput)
  
  // Persona 描述参与扫描
  const personaInjection = getPersonaInjection(persona)
  if (personaInjection.shouldInject && personaInjection.scanForWorldInfo) {
    texts.push(personaInjection.content)
  }
  
  const result = scanner.scan(texts, userInput)
  
  return { entries: allEntries, result }
}

/**
 * 估算 token 数
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

/**
 * 为群聊中指定的发言者构建上下文
 * 
 * @param group - 群组信息
 * @param members - 群组成员 (包含角色卡信息)
 * @param currentSpeaker - 当前发言者
 * @param messages - 聊天历史
 * @param persona - 用户 Persona
 * @param userInput - 当前用户输入 (可选)
 * @param config - 配置选项
 */
export async function buildGroupContext(
  group: TavernGroup,
  members: GroupMemberWithCard[],
  currentSpeaker: GroupMemberWithCard,
  messages: TavernMessage[],
  persona: TavernPersona,
  userInput?: string,
  config: Partial<GroupContextConfig> = {}
): Promise<GroupContextResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const aiMessages: AIMessage[] = []
  
  // 获取活跃成员
  const activeMembers = members.filter(m => m.isActive)
  
  // 根据角色信息模式确定要包含的成员
  let membersForContext: GroupMemberWithCard[]
  const characterMode = group.characterMode ?? GroupCharacterMode.SINGLE
  
  switch (characterMode) {
    case GroupCharacterMode.JOINT:
      // 联合模式: 包含所有活跃成员
      membersForContext = activeMembers
      break
    case GroupCharacterMode.JOINT_EXCLUDE_MUTED:
      // 联合排除静音: 包含所有非静音的活跃成员 + 当前发言者
      membersForContext = activeMembers.filter(m => !m.isMuted || m.cardId === currentSpeaker.cardId)
      break
    case GroupCharacterMode.SINGLE:
    default:
      // 单一模式: 只包含当前发言者
      membersForContext = [currentSpeaker]
      break
  }
  
  // 创建模板引擎 (使用当前发言者)
  const templateEngine = TavernTemplateEngine.fromCardAndPersona(currentSpeaker, persona)
  
  // ========== 1. 获取 SysPrompt ==========
  const sysPrompt = useTavernSysPromptStore.getState().getEnabled()
  const effectiveSystemPrompt = getEffectiveSystemPrompt(currentSpeaker.systemPrompt || '', sysPrompt)
  const effectivePostHistory = getEffectivePostHistory(currentSpeaker.postHistoryInstructions || '', sysPrompt)
  
  // ========== 2. 扫描世界书 ==========
  let worldInfoResult: WorldInfoScanResult | undefined
  if (cfg.includeWorldInfo) {
    const wiData = await scanWorldInfo(membersForContext, messages, persona, userInput)
    worldInfoResult = wiData.result
  }
  
  // ========== 3. 构建系统提示词 ==========
  const systemParts: string[] = []
  
  // 主系统提示词
  if (effectiveSystemPrompt) {
    systemParts.push(templateEngine.process(effectiveSystemPrompt))
  }
  
  // 世界书 Before
  if (worldInfoResult?.contentBefore) {
    systemParts.push(`[World Info]\n${worldInfoResult.contentBefore}`)
  }
  
  // 角色信息 (根据模式)
  if (characterMode === GroupCharacterMode.SINGLE) {
    // 单一模式: 只包含当前发言者
    if (currentSpeaker.description) {
      systemParts.push(`[Character: ${currentSpeaker.name}]`)
      systemParts.push(`Description: ${templateEngine.process(currentSpeaker.description)}`)
    }
    if (currentSpeaker.personality) {
      systemParts.push(`Personality: ${templateEngine.process(currentSpeaker.personality)}`)
    }
    // 场景 (优先使用覆盖)
    const scenario = group.scenarioOverride || currentSpeaker.scenario
    if (scenario) {
      systemParts.push(`[Scenario]\n${templateEngine.process(scenario)}`)
    }
  } else {
    // 联合模式: 合并所有成员信息
    const jointPrompt = buildJointCharacterPrompt(membersForContext, group, persona, currentSpeaker)
    systemParts.push(jointPrompt)
  }
  
  // 世界书 After
  if (worldInfoResult?.contentAfter) {
    systemParts.push(`[Additional Info]\n${worldInfoResult.contentAfter}`)
  }
  
  // Persona 信息
  const personaInjection = getPersonaInjection(persona)
  if (personaInjection.shouldInject) {
    systemParts.push(`[User: ${persona.name}]\n${personaInjection.content}`)
  }
  
  // Author's Note (如果配置为系统提示词位置)
  if (cfg.includeAuthorsNote) {
    try {
      const anStore = useTavernAuthorsNoteStore.getState()
      // 群聊使用第一个成员的 card ID
      const anConfig = anStore.getEffectiveConfig(members[0]?.cardId || 0, messages[0]?.chatId)
      if (anConfig.enabled && anConfig.content && anConfig.position !== AuthorsNotePosition.InChat) {
        systemParts.push(`[Author's Note]\n${anConfig.content}`)
      }
    } catch (e) {
      console.warn('Failed to get authors note for group chat:', e)
    }
  }
  
  // 群聊指令
  systemParts.push(`\n[Instructions]`)
  systemParts.push(`This is a group chat. Respond only as ${currentSpeaker.name}.`)
  systemParts.push(`Do not speak for other characters or the user.`)
  systemParts.push(`Messages are prefixed with [CharacterName]: to indicate the speaker.`)
  
  // 添加系统提示词
  if (systemParts.length > 0) {
    aiMessages.push({
      role: 'system',
      content: systemParts.join('\n\n'),
    })
  }
  
  // ========== 4. 聊天历史 ==========
  
  // 格式化历史消息
  const formattedHistory = formatGroupChatHistory(messages, persona.name)
  
  // Token 预算
  const tokenBudget = cfg.maxContext - cfg.maxResponse
  let usedTokens = aiMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  
  // 从最新到最旧添加历史消息
  const historyMessages: AIMessage[] = []
  for (let i = formattedHistory.length - 1; i >= 0; i--) {
    const msg = formattedHistory[i]
    const msgTokens = estimateTokens(msg.content)
    if (usedTokens + msgTokens > tokenBudget) break
    historyMessages.unshift(msg)
    usedTokens += msgTokens
  }
  
  // 添加新聊天标记
  aiMessages.push({
    role: 'system',
    content: `[Start of group chat. Members: ${activeMembers.map(m => m.name).join(', ')}]`,
  })
  
  // 添加历史消息
  aiMessages.push(...historyMessages)
  
  // 添加当前用户输入
  if (userInput) {
    aiMessages.push({
      role: 'user',
      content: `[${persona.name}]: ${userInput}`,
      name: persona.name,
    })
  }
  
  // ========== 5. 深度注入 ==========
  
  // Author's Note (IN_CHAT 位置)
  if (cfg.includeAuthorsNote) {
    try {
      const anStore = useTavernAuthorsNoteStore.getState()
      const anConfig = anStore.getEffectiveConfig(members[0]?.cardId || 0, messages[0]?.chatId)
      if (anConfig.enabled && anConfig.content && anConfig.position === AuthorsNotePosition.InChat) {
        // 在指定深度插入
        const depth = anConfig.depth ?? 4
        const insertIndex = Math.max(0, aiMessages.length - depth)
        aiMessages.splice(insertIndex, 0, {
          role: 'system',
          content: anConfig.content,
        })
      }
    } catch (e) {
      // 忽略
    }
  }
  
  // 世界书深度注入
  if (worldInfoResult?.depthContent) {
    for (const [depth, contents] of worldInfoResult.depthContent) {
      const content = contents.join('\n')
      const insertIndex = Math.max(0, aiMessages.length - depth)
      aiMessages.splice(insertIndex, 0, {
        role: 'system',
        content,
      })
    }
  }
  
  // ========== 6. Jailbreak (历史后指令) ==========
  if (effectivePostHistory) {
    aiMessages.push({
      role: 'system',
      content: templateEngine.process(effectivePostHistory),
    })
  }
  
  // 群聊提示 (确保只以当前角色回复)
  aiMessages.push({
    role: 'system',
    content: `[Respond only as ${currentSpeaker.name}. Do not include "[${currentSpeaker.name}]:" prefix in your response.]`,
  })
  
  // 计算总 token
  const totalTokens = aiMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  
  return {
    messages: aiMessages,
    tokenCount: totalTokens,
    worldInfoResult,
  }
}

/**
 * 快捷函数: 为群聊构建上下文
 */
export async function buildGroupContextSimple(
  group: TavernGroup,
  members: GroupMemberWithCard[],
  currentSpeaker: GroupMemberWithCard,
  messages: TavernMessage[],
  persona: TavernPersona,
  userInput?: string
): Promise<AIMessage[]> {
  const result = await buildGroupContext(
    group,
    members,
    currentSpeaker,
    messages,
    persona,
    userInput
  )
  return result.messages
}
