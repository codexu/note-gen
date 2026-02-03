/**
 * Tavern Helper - Core Types
 * 
 * 定义所有模块共享的核心类型
 */

// ============ 变量系统类型 ============

/**
 * 变量作用域
 */
export type VariableScope = 
  | 'global'      // 全局变量 - 跨会话持久化
  | 'preset'      // 预设变量 - 随预设切换
  | 'character'   // 角色变量 - 随角色切换
  | 'chat'        // 聊天变量 - 当前会话
  | 'message'     // 消息变量 - 单条消息
  | 'script'      // 脚本变量 - 插件临时变量

/**
 * 变量上下文 - 用于优先级解析
 */
export interface VariableContext {
  chatId?: number
  messageId?: number
  characterId?: number
  presetId?: number
  scriptId?: string
}

/**
 * 变量值类型
 */
export type VariableValue = string | number | boolean | null | VariableValue[] | { [key: string]: VariableValue }

// ============ 消息系统类型 ============

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * 聊天消息
 */
export interface ChatMessage {
  messageId: number
  chatId: number
  name: string
  role: MessageRole
  content: string
  isHidden: boolean
  swipeId: number
  swipes: string[]
  swipesData: Record<string, unknown>[]
  extra: MessageExtra
  sendDate: number
  genStarted?: number
  genFinished?: number
}

/**
 * 消息扩展数据
 */
export interface MessageExtra {
  api?: string
  model?: string
  tokenCount?: number
  reasoning?: string
  reasoningDuration?: number
  variables?: Record<string, VariableValue>
  [key: string]: unknown
}

/**
 * 新消息创建参数
 */
export interface NewMessage {
  name?: string
  role: MessageRole
  content: string
  isHidden?: boolean
  extra?: Partial<MessageExtra>
}

/**
 * 消息更新参数
 */
export interface MessageUpdate {
  messageId: number
  name?: string
  role?: MessageRole
  content?: string
  isHidden?: boolean
  extra?: Partial<MessageExtra>
  swipeId?: number
  swipes?: string[]
  swipesData?: Record<string, unknown>[]
}

/**
 * 获取消息选项
 */
export interface GetMessagesOptions {
  role?: 'all' | MessageRole
  hideState?: 'all' | 'hidden' | 'unhidden'
  includeSwipes?: boolean
}

/**
 * 创建消息选项
 */
export interface CreateMessagesOptions {
  insertAt?: number | 'end'
  refresh?: 'none' | 'affected' | 'all'
}

// ============ 生成系统类型 ============

/**
 * AI 消息格式
 */
export interface AIMessage {
  role: MessageRole
  content: string | AIMessageContent[]
  name?: string
}

/**
 * AI 消息内容 (多模态)
 */
export type AIMessageContent = 
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

/**
 * 生成配置
 */
export interface GenerateConfig {
  generationId?: string
  userInput?: string
  image?: string | string[]
  shouldStream?: boolean
  shouldSilence?: boolean
  maxChatHistory?: number | 'all'
  overrides?: GenerateOverrides
  injects?: InjectionPrompt[]
  customApi?: CustomApiConfig
}

/**
 * 原始生成配置 (不使用预设)
 */
export interface GenerateRawConfig extends GenerateConfig {
  orderedPrompts?: OrderedPrompt[]
}

/**
 * 生成覆盖配置
 */
export interface GenerateOverrides {
  worldInfoBefore?: string
  personaDescription?: string
  charDescription?: string
  charPersonality?: string
  scenario?: string
  worldInfoAfter?: string
  dialogueExamples?: string
  chatHistory?: {
    withDepthEntries?: boolean
    authorsNote?: string
    prompts?: AIMessage[]
  }
}

/**
 * 自定义 API 配置
 */
export interface CustomApiConfig {
  apiUrl?: string
  apiKey?: string
  model?: string
  maxTokens?: number | 'same_as_preset' | 'unset'
  temperature?: number | 'same_as_preset' | 'unset'
  frequencyPenalty?: number | 'same_as_preset' | 'unset'
  presencePenalty?: number | 'same_as_preset' | 'unset'
  topP?: number | 'same_as_preset' | 'unset'
  topK?: number | 'same_as_preset' | 'unset'
}

/**
 * 有序提示词
 */
export type OrderedPrompt = BuiltinPromptType | RolePrompt

/**
 * 内置提示词类型
 */
export type BuiltinPromptType =
  | 'world_info_before'
  | 'persona_description'
  | 'char_description'
  | 'char_personality'
  | 'scenario'
  | 'world_info_after'
  | 'dialogue_examples'
  | 'chat_history'
  | 'user_input'

/**
 * 角色提示词
 */
export interface RolePrompt {
  role: MessageRole
  content: string
  image?: string | string[]
}

/**
 * 生成上下文
 */
export interface GenerationContext {
  generationId: string
  chatId: number
  characterId: number
  userInput: string
  messages: AIMessage[]
  config: GenerateConfig
}

/**
 * 生成拦截器
 */
export interface GenerationInterceptor {
  id?: string
  priority?: number
  beforeGenerate?: (context: GenerationContext) => Promise<GenerationContext> | GenerationContext
  afterCombinePrompts?: (messages: AIMessage[], context: GenerationContext) => Promise<AIMessage[]> | AIMessage[]
  onStreamToken?: (token: string, fullText: string, context: GenerationContext) => void
  afterGenerate?: (result: string, context: GenerationContext) => Promise<string> | string
}

// ============ 提示词注入类型 ============

/**
 * 注入位置
 */
export type InjectionPosition = 'before' | 'after' | 'in_chat' | 'none'

/**
 * 注入提示词
 */
export interface InjectionPrompt {
  id: string
  content: string
  position: InjectionPosition
  depth?: number
  role?: MessageRole
  filter?: () => boolean | Promise<boolean>
  shouldScan?: boolean
}

/**
 * 注入选项
 */
export interface InjectOptions {
  once?: boolean
}

// ============ 宏系统类型 ============

/**
 * 宏上下文
 */
export interface MacroContext {
  messageId?: number
  role?: MessageRole
  chatId?: number
  characterId?: number
  variables: Record<string, VariableValue>
}

/**
 * 宏处理函数
 */
export type MacroHandler = (
  context: MacroContext,
  match: string,
  ...args: string[]
) => string | Promise<string>

/**
 * 宏定义
 */
export interface MacroDefinition {
  name: string
  pattern: RegExp
  handler: MacroHandler
  priority?: number
  description?: string
}

// ============ 事件系统类型 ============

/**
 * 事件优先级
 */
export type EventPriority = 'first' | 'high' | 'normal' | 'low' | 'last'

/**
 * 事件监听器
 */
export type EventListener<T = unknown> = (data: T) => void | Promise<void>

/**
 * 事件监听器包装
 */
export interface EventListenerWrapper<T = unknown> {
  listener: EventListener<T>
  priority: EventPriority
  once: boolean
  scopeId?: string
}

/**
 * 内置事件类型
 */
export const TAVERN_EVENTS = {
  // 消息事件
  MESSAGE_SENT: 'message_sent',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_EDITED: 'message_edited',
  MESSAGE_DELETED: 'message_deleted',
  MESSAGE_SWIPED: 'message_swiped',
  MESSAGE_RENDERED: 'message_rendered',
  USER_MESSAGE_RENDERED: 'user_message_rendered',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
  
  // 生成事件
  GENERATION_STARTED: 'generation_started',
  GENERATION_ENDED: 'generation_ended',
  GENERATION_STOPPED: 'generation_stopped',
  GENERATION_AFTER_COMMANDS: 'generation_after_commands',
  GENERATE_BEFORE_COMBINE_PROMPTS: 'generate_before_combine_prompts',
  GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
  GENERATE_AFTER_DATA: 'generate_after_data',
  
  // 流式事件
  STREAM_TOKEN_RECEIVED: 'stream_token_received',
  STREAM_TOKEN_RECEIVED_FULLY: 'stream_token_received_fully',
  STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'stream_token_received_incrementally',
  STREAM_REASONING_DONE: 'stream_reasoning_done',
  
  // 聊天事件
  CHAT_CHANGED: 'chat_changed',
  CHAT_CREATED: 'chat_created',
  CHAT_DELETED: 'chat_deleted',
  
  // 角色事件
  CHARACTER_SELECTED: 'character_selected',
  CHARACTER_EDITED: 'character_edited',
  CHARACTER_DELETED: 'character_deleted',
  
  // 世界书事件
  WORLDINFO_ACTIVATED: 'worldinfo_activated',
  WORLDINFO_UPDATED: 'worldinfo_updated',
  WORLDINFO_SCAN_DONE: 'worldinfo_scan_done',
  
  // 设置事件
  SETTINGS_UPDATED: 'settings_updated',
  PRESET_CHANGED: 'preset_changed',
  
  // 应用事件
  APP_READY: 'app_ready',
  
  // 错误事件
  TAVERN_HELPER_ERROR: 'tavern_helper_error',
} as const

export type TavernEventType = typeof TAVERN_EVENTS[keyof typeof TAVERN_EVENTS]

// ============ 消息事件数据类型 ============

export interface MessageEventData {
  messageId: number
  chatId: number
}

export interface MessageSwipedEventData extends MessageEventData {
  swipeId: number
  newSwipeId: number
}

export interface GenerationStartedEventData {
  generationId: string
  chatId: number
  type: string
}

export interface GenerationEndedEventData {
  generationId: string
  messageId: number
  content: string
}

export interface StreamTokenEventData {
  generationId: string
  token: string
  fullText: string
}

export interface ChatChangedEventData {
  chatId: number
  previousChatId?: number
}

export interface CharacterEventData {
  characterId: number
  characterName: string
}

export interface WorldInfoActivatedEventData {
  entries: unknown[]
  tokensUsed: number
}

// ============ 日志系统类型 ============

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * 日志条目
 */
export interface LogEntry {
  timestamp: number
  level: LogLevel
  message: string
  source?: string
  data?: unknown
}

/**
 * 日志过滤器
 */
export interface LogFilter {
  level?: LogLevel
  source?: string
  startTime?: number
  endTime?: number
  search?: string
}

// ============ 版本信息 ============

export const TAVERN_HELPER_VERSION = {
  major: 1,
  minor: 0,
  patch: 0,
  toString() {
    return `${this.major}.${this.minor}.${this.patch}`
  }
}
