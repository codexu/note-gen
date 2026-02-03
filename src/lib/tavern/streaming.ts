/**
 * ST 兼容的流式处理器
 * 管理流式生成过程中的实时渲染、token 计数、生成计时等
 */

import { estimateTokens } from './context-builder-v2'
import { TavernMessageExtra, TavernSwipeInfo, updateMessage, insertMessage, getLastMessage } from '@/db/tavern'

// 生成类型
export type GenerationType = 'normal' | 'swipe' | 'continue' | 'regenerate' | 'impersonate' | 'quiet'

// 流式处理器配置
export interface StreamingConfig {
  /** 生成类型 */
  type: GenerationType
  /** 聊天会话 ID */
  chatId: number
  /** 消息 ID (swipe/continue/regenerate 时需要) */
  messageId?: number
  /** 角色名称 */
  characterName: string
  /** 用户名称 */
  userName: string
  /** 强制头像 (群聊用) */
  forceAvatar?: string
  /** 原始头像标识 (群聊用) */
  originalAvatar?: string
  /** 继续生成时的前缀内容 */
  continuePrefix?: string
  /** 是否显示 reasoning */
  showReasoning?: boolean
}

// 流式处理器状态
export interface StreamingState {
  /** 是否正在生成 */
  isGenerating: boolean
  /** 是否已停止 */
  isStopped: boolean
  /** 是否已完成 */
  isFinished: boolean
  /** 当前消息 ID */
  messageId: number
  /** 当前内容 */
  content: string
  /** 推理内容 */
  reasoning: string
  /** Token 计数 */
  tokenCount: number
  /** Token 速率 (tokens/s) */
  tokenRate: number
  /** 生成开始时间 */
  genStarted: number
  /** 首个 token 到达时间 */
  timeToFirstToken: number | null
  /** 已生成时间 (秒) */
  elapsedTime: number
  /** 推理耗时 (毫秒) */
  reasoningDuration: number
}

// 流式处理器回调
export interface StreamingCallbacks {
  /** 内容更新回调 */
  onContentUpdate?: (content: string, state: StreamingState) => void
  /** 推理更新回调 */
  onReasoningUpdate?: (reasoning: string, state: StreamingState) => void
  /** 完成回调 */
  onFinish?: (state: StreamingState) => void
  /** 错误回调 */
  onError?: (error: Error, state: StreamingState) => void
  /** 停止回调 */
  onStop?: (state: StreamingState) => void
}

/**
 * 流式处理器类
 * 
 * 功能:
 * - 管理流式生成过程
 * - 实时计算 token 数量和生成速率
 * - 支持生成中断
 * - 支持 reasoning (思考过程) 提取
 * - 自动保存消息到数据库
 */
export class StreamingProcessor {
  private config: StreamingConfig
  private callbacks: StreamingCallbacks
  private state: StreamingState
  private abortController: AbortController | null = null
  private updateTimer: ReturnType<typeof setInterval> | null = null
  private lastTokenCount = 0
  private lastTokenTime = 0

  constructor(config: StreamingConfig, callbacks: StreamingCallbacks = {}) {
    this.config = config
    this.callbacks = callbacks
    this.state = {
      isGenerating: false,
      isStopped: false,
      isFinished: false,
      messageId: config.messageId || -1,
      content: config.continuePrefix || '',
      reasoning: '',
      tokenCount: 0,
      tokenRate: 0,
      genStarted: 0,
      timeToFirstToken: null,
      elapsedTime: 0,
      reasoningDuration: 0,
    }
  }

  /** 获取当前状态 */
  getState(): Readonly<StreamingState> {
    return { ...this.state }
  }

  /** 获取 AbortSignal 用于取消请求 */
  getSignal(): AbortSignal {
    if (!this.abortController) {
      this.abortController = new AbortController()
    }
    return this.abortController.signal
  }

  /** 开始流式处理 */
  async start(): Promise<number> {
    this.state.isGenerating = true
    this.state.isStopped = false
    this.state.isFinished = false
    this.state.genStarted = Date.now()
    this.abortController = new AbortController()

    // 启动计时器更新
    this.startUpdateTimer()

    // 如果是新消息 (normal/quiet)，创建消息记录
    if (this.config.type === 'normal' || this.config.type === 'quiet') {
      const messageId = await insertMessage({
        chatId: this.config.chatId,
        role: 'assistant',
        name: this.config.characterName,
        content: '...',
        sendDate: Date.now(),
        genStarted: this.state.genStarted,
        forceAvatar: this.config.forceAvatar || '',
        originalAvatar: this.config.originalAvatar || '',
        extra: JSON.stringify({
          api: 'streaming',
        } satisfies TavernMessageExtra),
      })
      this.state.messageId = messageId!
    }

    return this.state.messageId
  }

  /** 处理流式 chunk */
  async processChunk(chunk: string): Promise<void> {
    if (this.state.isStopped) return

    // 记录首个 token 时间
    if (this.state.timeToFirstToken === null && chunk.length > 0) {
      this.state.timeToFirstToken = Date.now() - this.state.genStarted
    }

    // 检测并提取 reasoning
    const { content, reasoning } = this.extractReasoning(chunk)

    // 更新内容
    if (content) {
      this.state.content += content
      this.callbacks.onContentUpdate?.(this.state.content, this.state)
    }

    // 更新 reasoning
    if (reasoning) {
      this.state.reasoning += reasoning
      this.callbacks.onReasoningUpdate?.(this.state.reasoning, this.state)
    }

    // 更新状态
    this.updateState()
  }

  /** 完成流式处理 */
  async finish(finalContent?: string): Promise<void> {
    if (this.state.isFinished) return

    this.stopUpdateTimer()
    this.state.isGenerating = false
    this.state.isFinished = true

    // 使用最终内容
    if (finalContent !== undefined) {
      this.state.content = this.config.continuePrefix 
        ? this.config.continuePrefix + finalContent 
        : finalContent
    }

    // 最终 token 计数
    const combinedText = this.state.reasoning + this.state.content
    this.state.tokenCount = estimateTokens(combinedText)

    // 计算最终时间
    const genFinished = Date.now()
    this.state.elapsedTime = (genFinished - this.state.genStarted) / 1000

    // 计算推理耗时 (如果有)
    if (this.state.reasoning && this.state.timeToFirstToken) {
      // 假设推理在首个 token 之前完成
      this.state.reasoningDuration = this.state.timeToFirstToken
    }

    // 保存消息到数据库
    await this.saveMessage(genFinished)

    this.callbacks.onFinish?.(this.state)
  }

  /** 停止生成 */
  stop(): void {
    if (this.state.isStopped || this.state.isFinished) return

    this.abortController?.abort('User stopped generation')
    this.state.isStopped = true
    this.state.isGenerating = false
    this.stopUpdateTimer()

    // 保存当前内容
    this.saveMessage(Date.now())

    this.callbacks.onStop?.(this.state)
  }

  /** 处理错误 */
  handleError(error: Error): void {
    this.stopUpdateTimer()
    this.state.isGenerating = false
    this.callbacks.onError?.(error, this.state)
  }

  // 私有方法

  private extractReasoning(text: string): { content: string; reasoning: string } {
    // 检测常见的 reasoning 标记
    // 格式1: <think>...</think>
    // 格式2: <reasoning>...</reasoning>
    // 格式3: [思考]...[/思考]

    const reasoningPatterns = [
      /<think>([\s\S]*?)<\/think>/gi,
      /<reasoning>([\s\S]*?)<\/reasoning>/gi,
      /\[思考\]([\s\S]*?)\[\/思考\]/gi,
    ]

    let content = text
    let reasoning = ''

    for (const pattern of reasoningPatterns) {
      const matches = text.matchAll(pattern)
      for (const match of matches) {
        reasoning += match[1]
        content = content.replace(match[0], '')
      }
    }

    return { content: content.trim(), reasoning: reasoning.trim() }
  }

  private updateState(): void {
    const now = Date.now()
    this.state.elapsedTime = (now - this.state.genStarted) / 1000

    // 估算当前 token 数
    const combinedText = this.state.reasoning + this.state.content
    this.state.tokenCount = estimateTokens(combinedText)

    // 计算 token 速率
    if (this.lastTokenTime > 0) {
      const timeDiff = (now - this.lastTokenTime) / 1000
      const tokenDiff = this.state.tokenCount - this.lastTokenCount
      if (timeDiff > 0.1) {
        this.state.tokenRate = tokenDiff / timeDiff
        this.lastTokenCount = this.state.tokenCount
        this.lastTokenTime = now
      }
    } else {
      this.lastTokenTime = now
      this.lastTokenCount = this.state.tokenCount
    }
  }

  private startUpdateTimer(): void {
    // 每 100ms 更新一次状态
    this.updateTimer = setInterval(() => {
      this.updateState()
    }, 100)
  }

  private stopUpdateTimer(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
  }

  private async saveMessage(genFinished: number): Promise<void> {
    if (this.state.messageId < 0) return

    const extra: TavernMessageExtra = {
      api: 'streaming',
      tokenCount: this.state.tokenCount,
    }

    if (this.state.reasoning) {
      extra.reasoning = this.state.reasoning
      extra.reasoningDuration = this.state.reasoningDuration
    }

    const swipeInfo: TavernSwipeInfo[] = [{
      sendDate: this.state.genStarted,
      genStarted: this.state.genStarted,
      genFinished: genFinished,
      extra: extra,
    }]

    await updateMessage(this.state.messageId, {
      content: this.state.content,
      genStarted: this.state.genStarted,
      genFinished: genFinished,
      swipes: JSON.stringify([this.state.content]),
      swipeInfo: JSON.stringify(swipeInfo),
      extra: JSON.stringify(extra),
    })
  }
}

/**
 * 格式化生成计时器显示
 */
export function formatGenerationTimer(
  genStarted: number | null,
  genFinished: number | null,
  tokenCount?: number,
  reasoningDuration?: number,
  timeToFirstToken?: number | null
): { timerValue: string; timerTitle: string } {
  if (!genStarted) {
    return { timerValue: '', timerTitle: '' }
  }

  const start = genStarted
  const finish = genFinished || Date.now()
  const seconds = (finish - start) / 1000

  const timerValue = `${seconds.toFixed(1)}s`
  
  const titleParts = [
    `生成开始: ${new Date(start).toLocaleString()}`,
    genFinished ? `生成完成: ${new Date(finish).toLocaleString()}` : '生成中...',
    `生成时间: ${seconds.toFixed(1)} 秒`,
  ]

  if (timeToFirstToken) {
    titleParts.push(`首 token 延迟: ${(timeToFirstToken / 1000).toFixed(2)} 秒`)
  }

  if (reasoningDuration && reasoningDuration > 0) {
    titleParts.push(`思考时间: ${(reasoningDuration / 1000).toFixed(2)} 秒`)
  }

  if (tokenCount && tokenCount > 0 && seconds > 0) {
    titleParts.push(`Token 速率: ${(tokenCount / seconds).toFixed(2)} t/s`)
  }

  return { timerValue, timerTitle: titleParts.join('\n') }
}

/**
 * 清理消息内容
 * - 移除未完成的句子 (可选)
 * - 处理 continue 模式的前缀
 * - 清理空白
 */
export function cleanUpMessage(options: {
  content: string
  isContinue?: boolean
  continuePrefix?: string
  displayIncompleteSentences?: boolean
  trimSpaces?: boolean
}): string {
  let result = options.content

  // Continue 模式下添加前缀
  if (options.isContinue && options.continuePrefix) {
    result = options.continuePrefix + result
  }

  // 清理空白
  if (options.trimSpaces !== false) {
    result = result.trim()
  }

  // 移除未完成的句子
  if (!options.displayIncompleteSentences) {
    result = trimToCompleteSentence(result)
  }

  return result
}

/**
 * 裁剪到完整句子
 */
function trimToCompleteSentence(text: string): string {
  if (!text) return text

  // 常见的句子结束标记
  const sentenceEnders = ['.', '!', '?', '。', '！', '？', '"', '"', '」', '』', ')', '）']
  
  // 从后向前找最近的句子结束标记
  for (let i = text.length - 1; i >= 0; i--) {
    if (sentenceEnders.includes(text[i])) {
      return text.slice(0, i + 1)
    }
  }

  // 没找到就返回原文
  return text
}

/**
 * Swipe 操作：添加新的生成变体
 */
export async function addSwipe(
  messageId: number,
  newContent: string,
  extra?: TavernMessageExtra
): Promise<void> {
  // 获取当前消息
  const { getMessageById } = await import('@/db/tavern')
  const message = await getMessageById(messageId)
  if (!message) return

  // 解析现有 swipes
  const swipes: string[] = JSON.parse(message.swipes || '[]')
  const swipeInfos: TavernSwipeInfo[] = JSON.parse(message.swipeInfo || '[]')

  // 添加新的 swipe
  const now = Date.now()
  swipes.push(newContent)
  swipeInfos.push({
    sendDate: now,
    genStarted: extra?.genId ? now : undefined,
    genFinished: now,
    extra: extra,
  })

  // 更新消息，切换到新 swipe
  const newSwipeId = swipes.length - 1
  await updateMessage(messageId, {
    content: newContent,
    swipeId: newSwipeId,
    swipes: JSON.stringify(swipes),
    swipeInfo: JSON.stringify(swipeInfos),
    extra: JSON.stringify(extra || {}),
  })
}

/**
 * Swipe 操作：切换到指定变体
 */
export async function switchSwipe(messageId: number, swipeId: number): Promise<string | null> {
  const { getMessageById } = await import('@/db/tavern')
  const message = await getMessageById(messageId)
  if (!message) return null

  const swipes: string[] = JSON.parse(message.swipes || '[]')
  const swipeInfos: TavernSwipeInfo[] = JSON.parse(message.swipeInfo || '[]')

  if (swipeId < 0 || swipeId >= swipes.length) return null

  const newContent = swipes[swipeId]
  const info = swipeInfos[swipeId]

  await updateMessage(messageId, {
    content: newContent,
    swipeId: swipeId,
    genStarted: info?.genStarted ?? null,
    genFinished: info?.genFinished ?? null,
    extra: JSON.stringify(info?.extra || {}),
  })

  return newContent
}

/**
 * 删除指定 swipe
 */
export async function deleteSwipe(messageId: number, swipeId: number): Promise<number> {
  const { getMessageById } = await import('@/db/tavern')
  const message = await getMessageById(messageId)
  if (!message) return -1

  const swipes: string[] = JSON.parse(message.swipes || '[]')
  const swipeInfos: TavernSwipeInfo[] = JSON.parse(message.swipeInfo || '[]')

  if (swipeId < 0 || swipeId >= swipes.length) return -1
  if (swipes.length <= 1) return 0 // 不能删除最后一个

  // 删除指定 swipe
  swipes.splice(swipeId, 1)
  swipeInfos.splice(swipeId, 1)

  // 计算新的 swipeId
  const newSwipeId = Math.min(swipeId, swipes.length - 1)
  const newContent = swipes[newSwipeId]
  const newInfo = swipeInfos[newSwipeId]

  await updateMessage(messageId, {
    content: newContent,
    swipeId: newSwipeId,
    swipes: JSON.stringify(swipes),
    swipeInfo: JSON.stringify(swipeInfos),
    genStarted: newInfo?.genStarted ?? null,
    genFinished: newInfo?.genFinished ?? null,
    extra: JSON.stringify(newInfo?.extra || {}),
  })

  return newSwipeId
}
