/**
 * ST 风格预设类型定义
 * 基于 SillyTavern 的预设系统设计
 */

// ============ 采样参数 ============

export interface SamplingParams {
  temperature: number          // 温度 0-2
  topP: number                 // Top P 0-1
  topK: number                 // Top K 0-500
  minP: number                 // Min P 0-1
  topA: number                 // Top A 0-1
  frequencyPenalty: number     // 频率惩罚 -2~2
  presencePenalty: number      // 存在惩罚 -2~2
  repetitionPenalty: number    // 重复惩罚 1-2
}

// ============ 基础设置 ============

export interface BasicSettings {
  maxContext: number           // 上下文长度 (tokens)
  maxResponse: number          // 最大回复长度 (tokens)
  unlockContext: boolean       // 解锁上下文长度限制
  candidateCount: number       // 每次生成候选数 (n)
  streaming: boolean           // 流式传输
  seed: number                 // 种子 (-1=随机)
  useSysPrompt: boolean        // 使用系统提示词
  showThoughts: boolean        // 显示思考过程
  enableWebSearch: boolean     // 启用网络搜索
  requestImages: boolean       // 请求生成图片
  requestImageAspectRatio: string // 图片宽高比
  requestImageResolution: string  // 图片分辨率
}

// ============ 预填充设置 ============

export interface PrefillSettings {
  assistantPrefill: string     // Assistant预填充
  assistantImpersonation: string // 扮演预填充
}

// ============ 行为设置 ============

export type CharacterNameBehavior = 'none' | 'default' | 'completion' | 'content'
export type ContinuePostfix = 'none' | 'space' | 'newline' | 'double_newline'
export type ImageQuality = 'auto' | 'low' | 'high'
export type ReasoningEffort = 'auto' | 'min' | 'low' | 'medium' | 'high' | 'max'
export type Verbosity = 'auto' | 'low' | 'medium' | 'high'

export interface BehaviorSettings {
  characterNameBehavior: CharacterNameBehavior
  continuePostfix: ContinuePostfix
  continuePrefill: boolean     // 继续预填充
  squashSystemMessages: boolean // 压缩系统消息
  enableFunctionCalling: boolean // 启用函数调用
  sendInlineMedia: boolean     // 发送内联媒体
  imageQuality: ImageQuality   // 图片画质
  reasoningEffort: ReasoningEffort // 推理强度
  verbosity: Verbosity         // 详细程度
}

// ============ Logit Bias ============

export interface LogitBiasEntry {
  id: string
  token: string                // Token 文本
  bias: number                 // 偏置值 -100~100
}

// ============ 提示词项目 ============

export type PromptRole = 'system' | 'user' | 'assistant'
export type PromptPosition = 'relative' | 'in-chat'
export type PromptTrigger = 'normal' | 'continue' | 'impersonate' | 'swipe' | 'regenerate' | 'quiet'

// 提示词标记类型（用于区分固定槽位和动态内容）
export type PromptMarkerType = 
  | 'main'              // 主提示词
  | 'worldInfoBefore'   // 前置世界信息
  | 'personaDescription' // 用户人设
  | 'charDescription'   // 角色描述
  | 'charPersonality'   // 角色性格
  | 'scenario'          // 场景
  | 'enhanceDefinitions' // 增强定义
  | 'auxiliary'         // 辅助提示词
  | 'worldInfoAfter'    // 后置世界信息
  | 'chatExamples'      // 对话示例
  | 'chatHistory'       // 聊天历史
  | 'postHistoryInstructions' // 历史后指令
  | 'custom'            // 自定义

export interface PromptItem {
  id: string
  name: string
  identifier: string           // 唯一标识符
  markerType: PromptMarkerType // 标记类型
  role: PromptRole
  content: string
  enabled: boolean
  position: PromptPosition
  depth: number               // 深度 (position='in-chat' 时有效)
  order: number               // 排序顺序
  triggers: PromptTrigger[]   // 触发类型
  forbidOverrides: boolean    // 禁止覆盖
  isSystem: boolean           // 是否系统内置（不可删除）
  marker: boolean             // 是否为标记提示词
  injectionOrder: number      // 同深度注入顺序 (默认100)
  injectionTrigger: string[]  // 触发条件数组
}

// ============ 提示词顺序 ============

export interface PromptOrderItem {
  identifier: string
  enabled: boolean
}

export interface PromptOrderEntry {
  characterId: number          // 角色ID (100000=默认, 100001=自定义)
  order: PromptOrderItem[]
}

// ============ 正则脚本 ============

export type RegexPlacement = 1 | 2  // 1=用户输入, 2=AI输出

export interface RegexScript {
  id: string
  scriptName: string           // 脚本名称
  findRegex: string            // 查找正则
  replaceString: string        // 替换字符串
  trimStrings: string[]        // 修剪字符串
  placement: RegexPlacement[]  // 应用位置
  disabled: boolean            // 是否禁用
  markdownOnly: boolean        // 仅Markdown
  promptOnly: boolean          // 仅提示词
  runOnEdit: boolean           // 编辑时运行
  substituteRegex: number      // 替代正则
  minDepth: number | null      // 最小深度
  maxDepth: number | null      // 最大深度
}

// ============ 快速提示词 ============

export interface QuickPrompts {
  main: string                 // 主提示词
  auxiliary: string            // 辅助提示词
  postHistoryInstructions: string // 历史后指令
}

// ============ 实用提示词 ============

export interface UtilityPrompts {
  impersonation: string        // 扮演提示
  worldInfoFormat: string      // 世界信息格式
  scenarioFormat: string       // 场景格式
  personalityFormat: string    // 性格格式
  groupNudge: string           // 群组引导
  newChat: string              // 新对话
  newGroupChat: string         // 新群组对话
  newExampleChat: string       // 新示例对话
  continueNudge: string        // 继续引导
  emptyMessage: string         // 空消息替换
}

// ============ 完整预设数据 ============

export interface CompletionPresetData {
  // 版本
  version: number
  
  // 基础设置
  basic: BasicSettings
  
  // 采样参数
  sampling: SamplingParams
  
  // 行为设置
  behavior: BehaviorSettings
  
  // 预填充设置
  prefill: PrefillSettings
  
  // Logit Bias
  logitBias: LogitBiasEntry[]
  
  // 提示词列表
  prompts: PromptItem[]
  
  // 提示词顺序
  promptOrder: PromptOrderEntry[]
  
  // 快速提示词
  quickPrompts: QuickPrompts
  
  // 实用提示词
  utilityPrompts: UtilityPrompts
  
  // 正则脚本
  regexScripts: RegexScript[]
}

// ============ 默认值 ============

export const DEFAULT_SAMPLING_PARAMS: SamplingParams = {
  temperature: 1.0,
  topP: 1.0,
  topK: 0,
  minP: 0,
  topA: 0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  repetitionPenalty: 1.0,
}

export const DEFAULT_BASIC_SETTINGS: BasicSettings = {
  maxContext: 4096,
  maxResponse: 300,
  unlockContext: false,
  candidateCount: 1,
  streaming: true,
  seed: -1,
  useSysPrompt: true,
  showThoughts: true,
  enableWebSearch: false,
  requestImages: false,
  requestImageAspectRatio: '',
  requestImageResolution: '',
}

export const DEFAULT_PREFILL_SETTINGS: PrefillSettings = {
  assistantPrefill: '',
  assistantImpersonation: '',
}

export const DEFAULT_BEHAVIOR_SETTINGS: BehaviorSettings = {
  characterNameBehavior: 'default',
  continuePostfix: 'space',
  continuePrefill: false,
  squashSystemMessages: false,
  enableFunctionCalling: false,
  sendInlineMedia: true,
  imageQuality: 'auto',
  reasoningEffort: 'auto',
  verbosity: 'auto',
}

export const DEFAULT_QUICK_PROMPTS: QuickPrompts = {
  main: '',
  auxiliary: '',
  postHistoryInstructions: '',
}

export const DEFAULT_UTILITY_PROMPTS: UtilityPrompts = {
  impersonation: 'Write {{user}}\'s next reply in this roleplay chat.',
  worldInfoFormat: '[Details: {0}]',
  scenarioFormat: '[Scenario: {{scenario}}]',
  personalityFormat: '[{{char}}\'s personality: {{personality}}]',
  groupNudge: '[Write the next reply only as {{char}}.]',
  newChat: '[Start a new conversation.]',
  newGroupChat: '[Start a new group conversation.]',
  newExampleChat: '[Example conversation]',
  continueNudge: '[Continue the following message as {{char}}:]',
  emptyMessage: '[The user doesn\'t say anything.]',
}

// 默认提示词列表
export const DEFAULT_PROMPTS: PromptItem[] = [
  {
    id: 'main',
    name: 'Main Prompt',
    identifier: 'main',
    markerType: 'main',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 0,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: true,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'worldInfoBefore',
    name: 'World Info (before)',
    identifier: 'worldInfoBefore',
    markerType: 'worldInfoBefore',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 1,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: true,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'personaDescription',
    name: 'Persona Description',
    identifier: 'personaDescription',
    markerType: 'personaDescription',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 2,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: true,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'charDescription',
    name: 'Char Description',
    identifier: 'charDescription',
    markerType: 'charDescription',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 3,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: true,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'charPersonality',
    name: 'Char Personality',
    identifier: 'charPersonality',
    markerType: 'charPersonality',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 4,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: true,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'scenario',
    name: 'Scenario',
    identifier: 'scenario',
    markerType: 'scenario',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 5,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: true,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'enhanceDefinitions',
    name: 'Enhance Definitions',
    identifier: 'enhanceDefinitions',
    markerType: 'enhanceDefinitions',
    role: 'system',
    content: '',
    enabled: false,
    position: 'relative',
    depth: 0,
    order: 6,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: false,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'auxiliary',
    name: 'Auxiliary Prompt',
    identifier: 'auxiliary',
    markerType: 'auxiliary',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 7,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: false,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'worldInfoAfter',
    name: 'World Info (after)',
    identifier: 'worldInfoAfter',
    markerType: 'worldInfoAfter',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 8,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: true,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'chatExamples',
    name: 'Chat Examples',
    identifier: 'chatExamples',
    markerType: 'chatExamples',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 9,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: true,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'chatHistory',
    name: 'Chat History',
    identifier: 'chatHistory',
    markerType: 'chatHistory',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 10,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: true,
    injectionOrder: 100,
    injectionTrigger: [],
  },
  {
    id: 'postHistoryInstructions',
    name: 'Post-History Instructions',
    identifier: 'postHistoryInstructions',
    markerType: 'postHistoryInstructions',
    role: 'system',
    content: '',
    enabled: true,
    position: 'relative',
    depth: 0,
    order: 11,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: false,
    isSystem: true,
    marker: false,
    injectionOrder: 100,
    injectionTrigger: [],
  },
]

// 默认提示词顺序
export const DEFAULT_PROMPT_ORDER: PromptOrderEntry[] = [
  {
    characterId: 100000,
    order: [
      { identifier: 'main', enabled: true },
      { identifier: 'worldInfoBefore', enabled: true },
      { identifier: 'personaDescription', enabled: true },
      { identifier: 'charDescription', enabled: true },
      { identifier: 'charPersonality', enabled: true },
      { identifier: 'scenario', enabled: true },
      { identifier: 'enhanceDefinitions', enabled: false },
      { identifier: 'auxiliary', enabled: true },
      { identifier: 'worldInfoAfter', enabled: true },
      { identifier: 'chatExamples', enabled: true },
      { identifier: 'chatHistory', enabled: true },
      { identifier: 'postHistoryInstructions', enabled: true },
    ],
  },
]

export function createDefaultCompletionPreset(): CompletionPresetData {
  return {
    version: 1,
    basic: { ...DEFAULT_BASIC_SETTINGS },
    sampling: { ...DEFAULT_SAMPLING_PARAMS },
    behavior: { ...DEFAULT_BEHAVIOR_SETTINGS },
    prefill: { ...DEFAULT_PREFILL_SETTINGS },
    logitBias: [],
    prompts: DEFAULT_PROMPTS.map(p => ({ ...p, injectionTrigger: [...p.injectionTrigger] })),
    promptOrder: DEFAULT_PROMPT_ORDER.map(e => ({ ...e, order: e.order.map(o => ({ ...o })) })),
    quickPrompts: { ...DEFAULT_QUICK_PROMPTS },
    utilityPrompts: { ...DEFAULT_UTILITY_PROMPTS },
    regexScripts: [],
  }
}

// ============ 提示词图标映射 ============

export const PROMPT_MARKER_ICONS: Record<PromptMarkerType, string> = {
  main: '📄',
  worldInfoBefore: '🎯',
  personaDescription: '🎯',
  charDescription: '🎯',
  charPersonality: '🎯',
  scenario: '🎯',
  enhanceDefinitions: '📄',
  auxiliary: '📄',
  worldInfoAfter: '🎯',
  chatExamples: '📄',
  chatHistory: '📄',
  postHistoryInstructions: '📄',
  custom: '✏️',
}

// ============ 中文标签映射 ============

export const PROMPT_MARKER_LABELS: Record<PromptMarkerType, string> = {
  main: '主提示词',
  worldInfoBefore: '世界信息 (前)',
  personaDescription: '用户人设',
  charDescription: '角色描述',
  charPersonality: '角色性格',
  scenario: '场景',
  enhanceDefinitions: '增强定义',
  auxiliary: '辅助提示词',
  worldInfoAfter: '世界信息 (后)',
  chatExamples: '对话示例',
  chatHistory: '聊天历史',
  postHistoryInstructions: '历史后指令',
  custom: '自定义',
}
