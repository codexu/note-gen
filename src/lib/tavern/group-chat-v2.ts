/**
 * Group Chat V2 - ST 风格的群聊系统
 * 
 * 支持 SillyTavern 的三种生成模式:
 * - SWAP: 切换模式 - 每次只用当前发言角色的卡片
 * - APPEND: 追加模式 - 合并所有启用成员的卡片
 * - APPEND_DISABLED: 全追加模式 - 合并所有成员的卡片(包括禁用的)
 * 
 * 支持四种激活策略:
 * - NATURAL: 自然对话 - 基于消息内容和提及
 * - LIST: 列表顺序 - 按成员列表顺序轮流
 * - MANUAL: 手动模式 - 用户指定或随机
 * - POOLED: 池化模式 - 基于最后消息选择
 */

import {
  TavernCard,
  TavernMessage,
  TavernPersona,
  TavernGroup,
  TavernGroupMember,
  TavernChat,
  GroupCharacterMode,
  getGroupById,
  getGroupMembers,
  getCardById,
  insertGroup,
  updateGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  updateGroupMember,
  // Re-export from db
  getGroups,
} from '@/db/tavern'
import { ContextBuilderV2, ContextBuilderV2Config, ContextBuildResultV2 } from './context-builder-v2'
import { DepthInjection } from './chat-completion'

// ============ 类型定义 ============

/**
 * 群聊生成模式
 */
export enum GroupGenerationMode {
  /** 切换模式 - 每次只用当前角色卡 */
  Swap = 0,
  /** 追加模式 - 合并所有启用成员的卡片 */
  Append = 1,
  /** 全追加模式 - 合并所有成员(包括禁用的) */
  AppendDisabled = 2,
}

/**
 * 群聊激活策略
 */
export enum GroupActivationStrategy {
  /** 自然对话 - 基于消息内容和提及 */
  Natural = 0,
  /** 列表顺序 - 按成员列表顺序轮流 */
  List = 1,
  /** 手动模式/随机 - 用户指定或随机 */
  Manual = 2,
  /** 随机选择 - Manual 的别名，保持兼容性 */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  Random = 2,
  /** 池化模式 - 基于最后消息选择 */
  Pooled = 3,
}

/**
 * 群聊成员 (带角色卡)
 */
export interface GroupMemberWithCard {
  member: TavernGroupMember
  card: TavernCard
}

/**
 * 合并后的角色卡
 */
export interface CombinedCharacterCard {
  description: string
  personality: string
  scenario: string
  mesExample: string
}

/**
 * 群聊上下文配置
 */
export interface GroupContextConfig extends Partial<ContextBuilderV2Config> {
  /** 生成模式 */
  generationMode?: GroupGenerationMode
  /** 激活策略 */
  activationStrategy?: GroupActivationStrategy
  /** 允许自我响应 */
  allowSelfResponses?: boolean
  /** 合并前缀 */
  joinPrefix?: string
  /** 合并后缀 */
  joinSuffix?: string
  /** 自动模式延迟 (秒) */
  autoModeDelay?: number
}

/** 默认自动模式延迟 (秒) */
export const DEFAULT_AUTO_MODE_DELAY = 5

/**
 * 群组设置
 */
export interface GroupSettings {
  name: string
  description?: string
  avatarPath?: string
  activationStrategy?: GroupActivationStrategy
  generationType?: number
  allowSelfResponses?: boolean
  favChecked?: boolean
  characterMode?: GroupCharacterMode
  scenarioOverride?: string
}

// Re-export database functions
export { getGroups, deleteGroup }

// ============ 群组管理函数 ============

/**
 * 创建新群组
 */
export async function createGroup(settings: GroupSettings): Promise<number> {
  return await insertGroup({
    name: settings.name,
    description: settings.description || '',
    avatarPath: settings.avatarPath || '',
    activationStrategy: settings.activationStrategy ?? GroupActivationStrategy.Natural,
    generationType: settings.generationType ?? GroupGenerationMode.Swap,
    allowSelfResponses: settings.allowSelfResponses ?? false,
    favChecked: settings.favChecked ?? false,
    characterMode: settings.characterMode ?? GroupCharacterMode.SINGLE,
    scenarioOverride: settings.scenarioOverride || '',
  }) as number
}

/**
 * 添加角色到群组
 */
export async function addCharacterToGroup(
  groupId: number,
  cardId: number,
  options?: { isActive?: boolean; sortOrder?: number }
): Promise<number> {
  const members = await getGroupMembers(groupId)
  const maxOrder = members.reduce((max, m) => Math.max(max, m.sortOrder), 0)

  return await addGroupMember({
    groupId,
    cardId,
    isActive: options?.isActive ?? true,
    isMuted: false,
    sortOrder: options?.sortOrder ?? maxOrder + 1,
  }) as number
}

/**
 * 从群组移除角色
 */
export async function removeCharacterFromGroup(memberId: number): Promise<void> {
  await removeGroupMember(memberId)
}

/**
 * 切换成员激活状态
 */
export async function toggleMemberActive(memberId: number, isActive: boolean): Promise<void> {
  await updateGroupMember(memberId, { isActive })
}

/**
 * 切换成员静音状态
 */
export async function toggleMemberMuted(memberId: number, isMuted: boolean): Promise<void> {
  await updateGroupMember(memberId, { isMuted })
}

/**
 * 更新成员排序
 */
export async function updateMemberOrder(memberId: number, sortOrder: number): Promise<void> {
  await updateGroupMember(memberId, { sortOrder })
}

/**
 * 批量更新成员排序
 */
export async function reorderMembers(
  memberOrders: { memberId: number; sortOrder: number }[]
): Promise<void> {
  for (const { memberId, sortOrder } of memberOrders) {
    await updateGroupMember(memberId, { sortOrder })
  }
}

/**
 * 群组聊天上下文 (用于列表页面显示)
 */
export interface GroupChatContext {
  group: TavernGroup
  members: GroupMemberWithCard[]
  activeMembers: GroupMemberWithCard[]
}

/**
 * 获取群组详情 (含成员)
 */
export async function getGroupWithMembers(groupId: number): Promise<GroupChatContext | null> {
  const group = await getGroupById(groupId)
  if (!group) return null

  const membersRaw = await getGroupMembers(groupId)
  const members: GroupMemberWithCard[] = []
  
  for (const m of membersRaw) {
    const card = await getCardById(m.cardId)
    if (card) {
      members.push({
        member: m,
        card,
      })
    }
  }
  
  // 按 sortOrder 排序
  members.sort((a, b) => (a.member.sortOrder || 0) - (b.member.sortOrder || 0))

  const activeMembers = members.filter(m => m.member.isActive && !m.member.isMuted)

  return {
    group,
    members,
    activeMembers,
  }
}

/**
 * 自动模式状态
 */
export interface AutoModeState {
  /** 是否启用 */
  enabled: boolean
  /** 是否正在生成 */
  isGenerating: boolean
  /** 当前生成 ID */
  generationId: number | null
  /** 发言队列 (Map<cardId, 顺序>) */
  speakerQueue: Map<number, number>
  /** 当前发言者 ID */
  currentSpeakerId: number | null
  /** 中止控制器 */
  abortController: AbortController | null
}

// ============ 群聊管理器 ============

/**
 * 自动模式回调类型
 */
export type AutoModeCallback = (
  speaker: GroupMemberWithCard,
  autoModeState: AutoModeState
) => Promise<void>

export class GroupChatManager {
  private group: TavernGroup
  private members: GroupMemberWithCard[] = []
  private config: GroupContextConfig
  
  // 自动模式状态
  private autoModeState: AutoModeState = {
    enabled: false,
    isGenerating: false,
    generationId: null,
    speakerQueue: new Map(),
    currentSpeakerId: null,
    abortController: null,
  }
  private autoModeWorker: ReturnType<typeof setInterval> | null = null
  private autoModeCallback: AutoModeCallback | null = null
  private lastMessages: TavernMessage[] = []
  
  constructor(group: TavernGroup, config: GroupContextConfig = {}) {
    this.group = group
    this.config = {
      generationMode: GroupGenerationMode.Swap,
      activationStrategy: GroupActivationStrategy.Natural,
      allowSelfResponses: false,
      joinPrefix: '[{{char}}]\n',
      joinSuffix: '\n',
      autoModeDelay: DEFAULT_AUTO_MODE_DELAY,
      ...config,
    }
  }
  
  // ============ 自动模式方法 ============
  
  /**
   * 获取自动模式状态
   */
  getAutoModeState(): Readonly<AutoModeState> {
    return { ...this.autoModeState }
  }
  
  /**
   * 启动自动模式
   * @param callback 生成回调函数 (接收发言者和状态)
   * @param messages 当前消息列表 (用于选择发言者)
   */
  startAutoMode(callback: AutoModeCallback, messages: TavernMessage[]): void {
    this.stopAutoMode()
    
    this.autoModeState.enabled = true
    this.autoModeCallback = callback
    this.lastMessages = messages
    
    const delay = (this.config.autoModeDelay ?? DEFAULT_AUTO_MODE_DELAY) * 1000
    this.autoModeWorker = setInterval(() => this.autoModeWorkerTick(), delay)
    
    console.log(`[GroupChat] Auto-mode started with ${delay}ms delay`)
  }
  
  /**
   * 停止自动模式
   */
  stopAutoMode(): void {
    if (this.autoModeWorker) {
      clearInterval(this.autoModeWorker)
      this.autoModeWorker = null
    }
    
    // 中止当前生成
    if (this.autoModeState.abortController) {
      this.autoModeState.abortController.abort()
    }
    
    this.autoModeState = {
      enabled: false,
      isGenerating: false,
      generationId: null,
      speakerQueue: new Map(),
      currentSpeakerId: null,
      abortController: null,
    }
    this.autoModeCallback = null
    
    console.log('[GroupChat] Auto-mode stopped')
  }
  
  /**
   * 更新自动模式延迟
   */
  setAutoModeDelay(delaySeconds: number): void {
    this.config.autoModeDelay = delaySeconds
    
    // 如果正在运行，重启 worker
    if (this.autoModeState.enabled && this.autoModeCallback) {
      const callback = this.autoModeCallback
      const messages = this.lastMessages
      this.stopAutoMode()
      this.startAutoMode(callback, messages)
    }
  }
  
  /**
   * 更新消息列表 (用于选择下一个发言者)
   */
  updateMessages(messages: TavernMessage[]): void {
    this.lastMessages = messages
  }
  
  /**
   * 获取发言队列 (用于 UI 显示)
   */
  getSpeakerQueue(): Map<number, number> {
    return new Map(this.autoModeState.speakerQueue)
  }
  
  /**
   * 自动模式 worker 执行
   */
  private async autoModeWorkerTick(): Promise<void> {
    // 检查是否可以执行
    if (!this.autoModeState.enabled) {
      return
    }
    
    if (this.autoModeState.isGenerating) {
      console.log('[GroupChat] Auto-mode: already generating, skipping tick')
      return
    }
    
    const activeMembers = this.getActiveMembers()
    if (activeMembers.length === 0) {
      console.log('[GroupChat] Auto-mode: no active members')
      return
    }
    
    if (!this.autoModeCallback) {
      console.warn('[GroupChat] Auto-mode: no callback set')
      return
    }
    
    try {
      this.autoModeState.isGenerating = true
      this.autoModeState.generationId = Date.now()
      this.autoModeState.abortController = new AbortController()
      
      // 选择下一个发言者
      const lastSpeakerId = this.autoModeState.currentSpeakerId ?? undefined
      const speaker = this.selectNextSpeaker(this.lastMessages, lastSpeakerId)
      
      if (!speaker) {
        console.log('[GroupChat] Auto-mode: no speaker selected')
        return
      }
      
      // 更新队列
      this.autoModeState.currentSpeakerId = speaker.card.id
      this.updateSpeakerQueue([speaker])
      
      console.log(`[GroupChat] Auto-mode: selected speaker ${speaker.card.name}`)
      
      // 调用生成回调
      await this.autoModeCallback(speaker, this.autoModeState)
      
      // 从队列中移除
      this.autoModeState.speakerQueue.delete(speaker.card.id)
      this.decrementQueueOrder()
      
    } catch (error) {
      if (error instanceof Error && error.message.includes('abort')) {
        console.log('[GroupChat] Auto-mode: generation aborted')
      } else {
        console.error('[GroupChat] Auto-mode error:', error)
      }
    } finally {
      this.autoModeState.isGenerating = false
      this.autoModeState.abortController = null
    }
  }
  
  /**
   * 更新发言队列
   */
  private updateSpeakerQueue(speakers: GroupMemberWithCard[]): void {
    this.autoModeState.speakerQueue.clear()
    speakers.forEach((speaker, index) => {
      this.autoModeState.speakerQueue.set(speaker.card.id, index + 1)
    })
  }
  
  /**
   * 降低队列顺序 (完成一个后)
   */
  private decrementQueueOrder(): void {
    const newQueue = new Map<number, number>()
    this.autoModeState.speakerQueue.forEach((order, cardId) => {
      newQueue.set(cardId, order - 1)
    })
    this.autoModeState.speakerQueue = newQueue
  }
  
  /**
   * 手动触发群聊生成 (可指定发言者)
   */
  async triggerGeneration(
    callback: AutoModeCallback,
    messages: TavernMessage[],
    forcedSpeakerId?: number
  ): Promise<void> {
    if (this.autoModeState.isGenerating) {
      console.warn('[GroupChat] Already generating')
      return
    }
    
    this.lastMessages = messages
    
    const activeMembers = this.getActiveMembers()
    if (activeMembers.length === 0) {
      console.warn('[GroupChat] No active members')
      return
    }
    
    try {
      this.autoModeState.isGenerating = true
      this.autoModeState.generationId = Date.now()
      this.autoModeState.abortController = new AbortController()
      
      // 选择发言者
      const lastSpeakerId = this.autoModeState.currentSpeakerId ?? undefined
      const speaker = forcedSpeakerId
        ? activeMembers.find(m => m.card.id === forcedSpeakerId) || this.selectNextSpeaker(messages, lastSpeakerId)
        : this.selectNextSpeaker(messages, lastSpeakerId)
      
      if (!speaker) {
        console.warn('[GroupChat] No speaker selected')
        return
      }
      
      this.autoModeState.currentSpeakerId = speaker.card.id
      this.updateSpeakerQueue([speaker])
      
      await callback(speaker, this.autoModeState)
      
      this.autoModeState.speakerQueue.delete(speaker.card.id)
      
    } finally {
      this.autoModeState.isGenerating = false
      this.autoModeState.abortController = null
    }
  }
  
  /**
   * 中止当前生成
   */
  abortGeneration(): void {
    if (this.autoModeState.abortController) {
      this.autoModeState.abortController.abort()
      console.log('[GroupChat] Generation aborted')
    }
  }
  
  // ============ 成员管理方法 ============
  
  /**
   * 加载群组成员
   */
  async loadMembers(): Promise<void> {
    const membersRaw = await getGroupMembers(this.group.id)
    this.members = []
    
    for (const member of membersRaw) {
      const card = await getCardById(member.cardId)
      if (card) {
        this.members.push({ member, card })
      }
    }
    
    // 按排序顺序排列
    this.members.sort((a, b) => a.member.sortOrder - b.member.sortOrder)
  }
  
  /**
   * 获取启用的成员
   */
  getActiveMembers(): GroupMemberWithCard[] {
    return this.members.filter(m => m.member.isActive && !m.member.isMuted)
  }
  
  /**
   * 获取所有成员
   */
  getAllMembers(): GroupMemberWithCard[] {
    return this.members
  }
  
  /**
   * 选择下一个发言者
   */
  selectNextSpeaker(
    messages: TavernMessage[],
    lastSpeakerId?: number,
    forcedId?: number
  ): GroupMemberWithCard | null {
    const activeMembers = this.getActiveMembers()
    if (activeMembers.length === 0) return null
    
    // 如果指定了强制 ID
    if (forcedId !== undefined) {
      return activeMembers.find(m => m.card.id === forcedId) || null
    }
    
    const strategy = this.config.activationStrategy ?? GroupActivationStrategy.Natural
    
    switch (strategy) {
      case GroupActivationStrategy.List:
        return this.selectByList(activeMembers, lastSpeakerId)
      
      case GroupActivationStrategy.Manual:
        return this.selectRandom(activeMembers, lastSpeakerId)
      
      case GroupActivationStrategy.Pooled:
        return this.selectPooled(activeMembers, messages, lastSpeakerId)
      
      case GroupActivationStrategy.Natural:
      default:
        return this.selectNatural(activeMembers, messages, lastSpeakerId)
    }
  }
  
  /**
   * 列表顺序选择
   */
  private selectByList(
    members: GroupMemberWithCard[],
    lastSpeakerId?: number
  ): GroupMemberWithCard {
    if (!lastSpeakerId) return members[0]
    
    const lastIndex = members.findIndex(m => m.card.id === lastSpeakerId)
    if (lastIndex === -1) return members[0]
    
    return members[(lastIndex + 1) % members.length]
  }
  
  /**
   * 随机选择
   */
  private selectRandom(
    members: GroupMemberWithCard[],
    lastSpeakerId?: number
  ): GroupMemberWithCard {
    let candidates = members
    
    if (!this.config.allowSelfResponses && lastSpeakerId && members.length > 1) {
      candidates = members.filter(m => m.card.id !== lastSpeakerId)
    }
    
    return candidates[Math.floor(Math.random() * candidates.length)]
  }
  
  /**
   * 池化选择 (基于最后消息)
   */
  private selectPooled(
    members: GroupMemberWithCard[],
    messages: TavernMessage[],
    lastSpeakerId?: number
  ): GroupMemberWithCard {
    // 找到最后一条用户消息后的第一个未发言角色
    const lastUserIndex = messages.findLastIndex(m => m.role === 'user')
    if (lastUserIndex === -1) return this.selectRandom(members, lastSpeakerId)
    
    const recentSpeakers = new Set<number>()
    for (let i = lastUserIndex + 1; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role === 'assistant') {
        const member = members.find(m => m.card.name === msg.name)
        if (member) recentSpeakers.add(member.card.id)
      }
    }
    
    // 选择未发言的角色
    const notSpoken = members.filter(m => !recentSpeakers.has(m.card.id))
    if (notSpoken.length > 0) {
      return notSpoken[0]
    }
    
    return this.selectRandom(members, lastSpeakerId)
  }
  
  /**
   * 自然对话选择
   */
  private selectNatural(
    members: GroupMemberWithCard[],
    messages: TavernMessage[],
    lastSpeakerId?: number
  ): GroupMemberWithCard {
    // 检查最后一条消息是否有@提及
    const lastMessage = messages[messages.length - 1]
    if (lastMessage) {
      const content = lastMessage.content.toLowerCase()
      
      for (const member of members) {
        const name = member.card.name.toLowerCase()
        if (content.includes(`@${name}`) || content.includes(name)) {
          if (member.card.id !== lastSpeakerId || this.config.allowSelfResponses) {
            return member
          }
        }
      }
    }
    
    // 基于发言频率的加权随机
    const recentCount = Math.min(10, messages.length)
    const speakCounts = new Map<number, number>()
    
    for (let i = messages.length - 1; i >= messages.length - recentCount && i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant') {
        const member = members.find(m => m.card.name === msg.name)
        if (member) {
          speakCounts.set(member.card.id, (speakCounts.get(member.card.id) || 0) + 1)
        }
      }
    }
    
    // 计算权重 (发言越少权重越高)
    const weights = members.map(m => ({
      member: m,
      weight: Math.max(1, 10 - (speakCounts.get(m.card.id) || 0) * 2),
    }))
    
    // 加权随机
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0)
    let random = Math.random() * totalWeight
    
    for (const { member, weight } of weights) {
      random -= weight
      if (random <= 0) return member
    }
    
    return members[0]
  }
  
  /**
   * 合并角色卡 (APPEND 模式)
   */
  getCombinedCards(currentSpeakerId: number): CombinedCharacterCard {
    const mode = this.config.generationMode ?? GroupGenerationMode.Swap
    
    // SWAP 模式不合并
    if (mode === GroupGenerationMode.Swap) {
      const speaker = this.members.find(m => m.card.id === currentSpeakerId)
      if (speaker) {
        return {
          description: speaker.card.description || '',
          personality: speaker.card.personality || '',
          scenario: speaker.card.scenario || '',
          mesExample: speaker.card.mesExample || '',
        }
      }
      return { description: '', personality: '', scenario: '', mesExample: '' }
    }
    
    // APPEND 或 APPEND_DISABLED 模式
    const membersToMerge = mode === GroupGenerationMode.AppendDisabled
      ? this.members
      : this.members.filter(m => m.member.isActive || m.card.id === currentSpeakerId)
    
    const prefix = this.config.joinPrefix || '[{{char}}]\n'
    const suffix = this.config.joinSuffix || '\n'
    
    const combine = (field: keyof TavernCard, fieldName: string): string => {
      const parts: string[] = []
      
      for (const { card } of membersToMerge) {
        const value = card[field] as string
        if (value?.trim()) {
          const processedPrefix = prefix.replace(/\{\{char\}\}/gi, card.name)
            .replace(/<FIELDNAME>/gi, fieldName)
          const processedSuffix = suffix.replace(/\{\{char\}\}/gi, card.name)
            .replace(/<FIELDNAME>/gi, fieldName)
          parts.push(`${processedPrefix}${value.trim()}${processedSuffix}`)
        }
      }
      
      return parts.join('\n')
    }
    
    return {
      description: combine('description', 'Description'),
      personality: combine('personality', 'Personality'),
      scenario: combine('scenario', 'Scenario'),
      mesExample: combine('mesExample', 'Example Messages'),
    }
  }
  
  /**
   * 获取群组深度提示词
   */
  getGroupDepthPrompts(currentSpeakerId: number): DepthInjection[] {
    const mode = this.config.generationMode ?? GroupGenerationMode.Swap
    
    // SWAP 模式不收集其他成员的深度提示词
    if (mode === GroupGenerationMode.Swap) {
      const speaker = this.members.find(m => m.card.id === currentSpeakerId)
      if (speaker?.card.depthPromptText) {
        return [{
          role: (speaker.card.depthPromptRole || 'system') as 'system' | 'user' | 'assistant',
          content: speaker.card.depthPromptText,
          depth: speaker.card.depthPromptDepth ?? 4,
          order: 100,
          identifier: `depthPrompt_${speaker.card.id}`,
        }]
      }
      return []
    }
    
    // APPEND 模式收集所有成员的深度提示词
    const prompts: DepthInjection[] = []
    
    for (const { member, card } of this.members) {
      // 跳过禁用成员 (除非是当前发言者或 APPEND_DISABLED 模式)
      if (!member.isActive && card.id !== currentSpeakerId && mode !== GroupGenerationMode.AppendDisabled) {
        continue
      }
      
      if (card.depthPromptText) {
        prompts.push({
          role: (card.depthPromptRole || 'system') as 'system' | 'user' | 'assistant',
          content: card.depthPromptText.replace(/\{\{char\}\}/gi, card.name),
          depth: card.depthPromptDepth ?? 4,
          order: 100 - prompts.length, // 按顺序递减优先级
          identifier: `depthPrompt_${card.id}`,
        })
      }
    }
    
    return prompts
  }
  
  /**
   * 构建群聊上下文
   */
  async buildContext(
    speaker: GroupMemberWithCard,
    persona: TavernPersona,
    messages: TavernMessage[],
    userInput?: string
  ): Promise<ContextBuildResultV2> {
    const memberNames = this.getActiveMembers().map(m => m.card.name)
    
    // 获取合并后的卡片内容
    const combined = this.getCombinedCards(speaker.card.id)
    
    // 创建临时角色卡
    const groupCard: TavernCard = {
      ...speaker.card,
      description: combined.description || speaker.card.description,
      personality: combined.personality || speaker.card.personality,
      scenario: this.buildGroupScenario(speaker, combined.scenario),
      mesExample: combined.mesExample || speaker.card.mesExample,
      // 系统提示词添加群聊指令
      systemPrompt: this.buildGroupSystemPrompt(speaker.card),
    }
    
    // 构建上下文
    const builder = new ContextBuilderV2(groupCard, persona, {
      ...this.config,
      isGroupChat: true,
      groupMembers: memberNames,
    })
    
    return builder.build(messages, userInput)
  }
  
  /**
   * 构建群聊场景
   */
  private buildGroupScenario(speaker: GroupMemberWithCard, combinedScenario?: string): string {
    const otherMembers = this.getActiveMembers()
      .filter(m => m.card.id !== speaker.card.id)
      .map(m => m.card.name)
    
    let scenario = `[群聊: ${this.group.name}]\n`
    scenario += `这是一个多角色群聊对话。\n`
    
    if (otherMembers.length > 0) {
      scenario += `其他在场角色: ${otherMembers.join(', ')}\n`
    }
    
    if (this.group.description) {
      scenario += `场景: ${this.group.description}\n`
    }
    
    scenario += `\n你是 ${speaker.card.name}。仅以 ${speaker.card.name} 的身份回复。`
    
    if (combinedScenario) {
      scenario += `\n\n${combinedScenario}`
    }
    
    return scenario
  }
  
  /**
   * 构建群聊系统提示词
   */
  private buildGroupSystemPrompt(card: TavernCard): string {
    const groupInstructions = `[群聊指令]
- 你正在群聊中扮演 ${card.name}
- 仅以 ${card.name} 的身份撰写回复
- 不要为其他角色撰写动作或对话
- 你可以引用或回应其他角色的消息
- 保持 ${card.name} 的角色设定`
    
    return groupInstructions + (card.systemPrompt ? `\n\n${card.systemPrompt}` : '')
  }
}

// ============ 快捷函数 ============

/**
 * 加载群组并创建管理器
 */
export async function createGroupChatManager(
  groupId: number,
  config?: GroupContextConfig
): Promise<GroupChatManager | null> {
  const group = await getGroupById(groupId)
  if (!group) return null
  
  const manager = new GroupChatManager(group, config)
  await manager.loadMembers()
  
  return manager
}

/**
 * 快速构建群聊上下文
 */
export async function buildGroupContext(
  groupId: number,
  speakerId: number,
  persona: TavernPersona,
  messages: TavernMessage[],
  userInput?: string,
  config?: GroupContextConfig
): Promise<ContextBuildResultV2 | null> {
  const manager = await createGroupChatManager(groupId, config)
  if (!manager) return null
  
  const speaker = manager.getAllMembers().find(m => m.card.id === speakerId)
  if (!speaker) return null
  
  return manager.buildContext(speaker, persona, messages, userInput)
}
