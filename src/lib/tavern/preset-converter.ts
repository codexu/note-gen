/**
 * ST 预设导入/导出转换器
 * 处理 SillyTavern JSON 格式与内部格式之间的转换
 */

import {
  CompletionPresetData,
  SamplingParams,
  BasicSettings,
  BehaviorSettings,
  PrefillSettings,
  PromptItem,
  PromptOrderEntry,
  RegexScript,
  QuickPrompts,
  UtilityPrompts,
  PromptMarkerType,
  PromptRole,
  CharacterNameBehavior,
  ContinuePostfix,
  createDefaultCompletionPreset,
} from './preset-types'

// ============ ST 预设 JSON 类型定义 ============

interface STPromptItem {
  identifier: string
  name: string
  system_prompt: boolean
  enabled?: boolean
  marker?: boolean
  role: string
  content?: string
  injection_position?: number
  injection_depth?: number
  forbid_overrides?: boolean
  injection_order?: number
  injection_trigger?: string[]
}

interface STPromptOrderItem {
  identifier: string
  enabled: boolean
}

interface STPromptOrderEntry {
  character_id: number
  order: STPromptOrderItem[]
}

interface STRegexScript {
  id: string
  scriptName: string
  findRegex: string
  replaceString: string
  trimStrings: string[]
  placement: number[]
  disabled: boolean
  markdownOnly: boolean
  promptOnly: boolean
  runOnEdit: boolean
  substituteRegex: number
  minDepth: number | null
  maxDepth: number | null
}

interface STPresetJSON {
  // 采样参数
  temperature?: number
  frequency_penalty?: number
  presence_penalty?: number
  top_p?: number
  top_k?: number
  top_a?: number
  min_p?: number
  repetition_penalty?: number

  // 上下文设置
  max_context_unlocked?: boolean
  openai_max_context?: number
  openai_max_tokens?: number

  // 行为设置
  names_behavior?: number
  stream_openai?: boolean
  squash_system_messages?: boolean
  function_calling?: boolean
  media_inlining?: boolean
  inline_image_quality?: string
  continue_prefill?: boolean
  continue_postfix?: string
  reasoning_effort?: string
  verbosity?: string

  // 基础设置
  use_sysprompt?: boolean
  show_thoughts?: boolean
  enable_web_search?: boolean
  seed?: number
  n?: number
  request_images?: boolean
  request_image_aspect_ratio?: string
  request_image_resolution?: string

  // 预填充
  assistant_prefill?: string
  assistant_impersonation?: string

  // 实用提示词
  send_if_empty?: string
  impersonation_prompt?: string
  new_chat_prompt?: string
  new_group_chat_prompt?: string
  new_example_chat_prompt?: string
  continue_nudge_prompt?: string
  wi_format?: string
  scenario_format?: string
  personality_format?: string
  group_nudge_prompt?: string

  // 提示词
  prompts?: STPromptItem[]
  prompt_order?: STPromptOrderEntry[]

  // 正则脚本
  extensions?: {
    regex_scripts?: STRegexScript[]
  }
}

// ============ 导入转换 ============

/**
 * 将 ST 预设 JSON 转换为内部格式
 */
export function importSTPreset(stPreset: STPresetJSON): CompletionPresetData {
  const defaultPreset = createDefaultCompletionPreset()

  // 采样参数
  const sampling: SamplingParams = {
    temperature: stPreset.temperature ?? defaultPreset.sampling.temperature,
    topP: stPreset.top_p ?? defaultPreset.sampling.topP,
    topK: stPreset.top_k ?? defaultPreset.sampling.topK,
    minP: stPreset.min_p ?? defaultPreset.sampling.minP,
    topA: stPreset.top_a ?? defaultPreset.sampling.topA,
    frequencyPenalty: stPreset.frequency_penalty ?? defaultPreset.sampling.frequencyPenalty,
    presencePenalty: stPreset.presence_penalty ?? defaultPreset.sampling.presencePenalty,
    repetitionPenalty: stPreset.repetition_penalty ?? defaultPreset.sampling.repetitionPenalty,
  }

  // 基础设置
  const basic: BasicSettings = {
    maxContext: stPreset.openai_max_context ?? defaultPreset.basic.maxContext,
    maxResponse: stPreset.openai_max_tokens ?? defaultPreset.basic.maxResponse,
    unlockContext: stPreset.max_context_unlocked ?? defaultPreset.basic.unlockContext,
    candidateCount: stPreset.n ?? defaultPreset.basic.candidateCount,
    streaming: stPreset.stream_openai ?? defaultPreset.basic.streaming,
    seed: stPreset.seed ?? defaultPreset.basic.seed,
    useSysPrompt: stPreset.use_sysprompt ?? defaultPreset.basic.useSysPrompt,
    showThoughts: stPreset.show_thoughts ?? defaultPreset.basic.showThoughts,
    enableWebSearch: stPreset.enable_web_search ?? defaultPreset.basic.enableWebSearch,
    requestImages: stPreset.request_images ?? defaultPreset.basic.requestImages,
    requestImageAspectRatio: stPreset.request_image_aspect_ratio ?? defaultPreset.basic.requestImageAspectRatio,
    requestImageResolution: stPreset.request_image_resolution ?? defaultPreset.basic.requestImageResolution,
  }

  // 行为设置
  const behavior: BehaviorSettings = {
    characterNameBehavior: convertNamesBehavior(stPreset.names_behavior),
    continuePostfix: convertContinuePostfix(stPreset.continue_postfix),
    continuePrefill: stPreset.continue_prefill ?? defaultPreset.behavior.continuePrefill,
    squashSystemMessages: stPreset.squash_system_messages ?? defaultPreset.behavior.squashSystemMessages,
    enableFunctionCalling: stPreset.function_calling ?? defaultPreset.behavior.enableFunctionCalling,
    sendInlineMedia: stPreset.media_inlining ?? defaultPreset.behavior.sendInlineMedia,
    imageQuality: (stPreset.inline_image_quality as 'auto' | 'low' | 'high') ?? defaultPreset.behavior.imageQuality,
    reasoningEffort: (stPreset.reasoning_effort as any) ?? defaultPreset.behavior.reasoningEffort,
    verbosity: (stPreset.verbosity as any) ?? defaultPreset.behavior.verbosity,
  }

  // 预填充设置
  const prefill: PrefillSettings = {
    assistantPrefill: stPreset.assistant_prefill ?? defaultPreset.prefill.assistantPrefill,
    assistantImpersonation: stPreset.assistant_impersonation ?? defaultPreset.prefill.assistantImpersonation,
  }

  // 实用提示词
  const utilityPrompts: UtilityPrompts = {
    impersonation: stPreset.impersonation_prompt ?? defaultPreset.utilityPrompts.impersonation,
    worldInfoFormat: stPreset.wi_format ?? defaultPreset.utilityPrompts.worldInfoFormat,
    scenarioFormat: stPreset.scenario_format ?? defaultPreset.utilityPrompts.scenarioFormat,
    personalityFormat: stPreset.personality_format ?? defaultPreset.utilityPrompts.personalityFormat,
    groupNudge: stPreset.group_nudge_prompt ?? defaultPreset.utilityPrompts.groupNudge,
    newChat: stPreset.new_chat_prompt ?? defaultPreset.utilityPrompts.newChat,
    newGroupChat: stPreset.new_group_chat_prompt ?? defaultPreset.utilityPrompts.newGroupChat,
    newExampleChat: stPreset.new_example_chat_prompt ?? defaultPreset.utilityPrompts.newExampleChat,
    continueNudge: stPreset.continue_nudge_prompt ?? defaultPreset.utilityPrompts.continueNudge,
    emptyMessage: stPreset.send_if_empty ?? defaultPreset.utilityPrompts.emptyMessage,
  }

  // 提示词列表
  let prompts: PromptItem[] = stPreset.prompts
    ? stPreset.prompts.map((p, index) => convertSTPromptItem(p, index))
    : defaultPreset.prompts

  // 提示词顺序
  const promptOrder: PromptOrderEntry[] = stPreset.prompt_order
    ? stPreset.prompt_order.map(convertSTPromptOrderEntry)
    : defaultPreset.promptOrder

  // 从 prompt_order 同步启用状态和排序到 prompts
  // 优先使用 100001 (自定义)，否则使用 100000 (默认)
  const customOrder = promptOrder.find(o => o.characterId === 100001)
  const defaultOrder = promptOrder.find(o => o.characterId === 100000)
  const activeOrder = customOrder || defaultOrder
  
  if (activeOrder) {
    // 创建 identifier -> enabled 的映射
    const enabledMap = new Map<string, boolean>()
    activeOrder.order.forEach(item => {
      enabledMap.set(item.identifier, item.enabled)
    })
    
    // 更新 prompts 的启用状态
    prompts = prompts.map(prompt => {
      if (enabledMap.has(prompt.identifier)) {
        return { ...prompt, enabled: enabledMap.get(prompt.identifier)! }
      }
      return prompt
    })
    
    // 根据 prompt_order 重新排序 prompts
    const orderMap = new Map<string, number>()
    activeOrder.order.forEach((item, index) => {
      orderMap.set(item.identifier, index)
    })
    
    prompts = prompts.map(prompt => {
      const orderIndex = orderMap.get(prompt.identifier)
      return {
        ...prompt,
        order: orderIndex !== undefined ? orderIndex : prompt.order + 1000 // 未在 order 中的放到后面
      }
    }).sort((a, b) => a.order - b.order)
  }

  // 正则脚本
  const regexScripts: RegexScript[] = stPreset.extensions?.regex_scripts
    ? stPreset.extensions.regex_scripts.map(convertSTRegexScript)
    : []

  return {
    version: 1,
    basic,
    sampling,
    behavior,
    prefill,
    logitBias: [],
    prompts,
    promptOrder,
    quickPrompts: defaultPreset.quickPrompts,
    utilityPrompts,
    regexScripts,
  }
}

// ============ 导出转换 ============

/**
 * 将内部格式转换为 ST 预设 JSON
 */
export function exportSTPreset(preset: CompletionPresetData): STPresetJSON {
  return {
    // 采样参数
    temperature: preset.sampling.temperature,
    frequency_penalty: preset.sampling.frequencyPenalty,
    presence_penalty: preset.sampling.presencePenalty,
    top_p: preset.sampling.topP,
    top_k: preset.sampling.topK,
    top_a: preset.sampling.topA,
    min_p: preset.sampling.minP,
    repetition_penalty: preset.sampling.repetitionPenalty,

    // 上下文设置
    max_context_unlocked: preset.basic.unlockContext,
    openai_max_context: preset.basic.maxContext,
    openai_max_tokens: preset.basic.maxResponse,

    // 行为设置
    names_behavior: exportNamesBehavior(preset.behavior.characterNameBehavior),
    stream_openai: preset.basic.streaming,
    squash_system_messages: preset.behavior.squashSystemMessages,
    function_calling: preset.behavior.enableFunctionCalling,
    media_inlining: preset.behavior.sendInlineMedia,
    inline_image_quality: preset.behavior.imageQuality,
    continue_prefill: preset.behavior.continuePrefill,
    continue_postfix: exportContinuePostfix(preset.behavior.continuePostfix),
    reasoning_effort: preset.behavior.reasoningEffort,
    verbosity: preset.behavior.verbosity,

    // 基础设置
    use_sysprompt: preset.basic.useSysPrompt,
    show_thoughts: preset.basic.showThoughts,
    enable_web_search: preset.basic.enableWebSearch,
    seed: preset.basic.seed,
    n: preset.basic.candidateCount,
    request_images: preset.basic.requestImages,
    request_image_aspect_ratio: preset.basic.requestImageAspectRatio,
    request_image_resolution: preset.basic.requestImageResolution,

    // 预填充
    assistant_prefill: preset.prefill.assistantPrefill,
    assistant_impersonation: preset.prefill.assistantImpersonation,

    // 实用提示词
    send_if_empty: preset.utilityPrompts.emptyMessage,
    impersonation_prompt: preset.utilityPrompts.impersonation,
    new_chat_prompt: preset.utilityPrompts.newChat,
    new_group_chat_prompt: preset.utilityPrompts.newGroupChat,
    new_example_chat_prompt: preset.utilityPrompts.newExampleChat,
    continue_nudge_prompt: preset.utilityPrompts.continueNudge,
    wi_format: preset.utilityPrompts.worldInfoFormat,
    scenario_format: preset.utilityPrompts.scenarioFormat,
    personality_format: preset.utilityPrompts.personalityFormat,
    group_nudge_prompt: preset.utilityPrompts.groupNudge,

    // 提示词
    prompts: preset.prompts.map(exportPromptItem),
    prompt_order: preset.promptOrder.map(exportPromptOrderEntry),

    // 正则脚本
    extensions: {
      regex_scripts: preset.regexScripts.map(exportRegexScript),
    },
  }
}

// ============ 辅助转换函数 ============

function convertNamesBehavior(value?: number): CharacterNameBehavior {
  switch (value) {
    case 0: return 'none'
    case 1: return 'default'
    case 2: return 'completion'
    case 3: return 'content'
    default: return 'default'
  }
}

function exportNamesBehavior(value: CharacterNameBehavior): number {
  switch (value) {
    case 'none': return 0
    case 'default': return 1
    case 'completion': return 2
    case 'content': return 3
    default: return 1
  }
}

function convertContinuePostfix(value?: string): ContinuePostfix {
  switch (value) {
    case '': return 'none'
    case ' ': return 'space'
    case '\n': return 'newline'
    case '\n\n': return 'double_newline'
    default: return 'space'
  }
}

function exportContinuePostfix(value: ContinuePostfix): string {
  switch (value) {
    case 'none': return ''
    case 'space': return ' '
    case 'newline': return '\n'
    case 'double_newline': return '\n\n'
    default: return ' '
  }
}

function getMarkerTypeFromIdentifier(identifier: string): PromptMarkerType {
  const markerTypes: Record<string, PromptMarkerType> = {
    main: 'main',
    worldInfoBefore: 'worldInfoBefore',
    personaDescription: 'personaDescription',
    charDescription: 'charDescription',
    charPersonality: 'charPersonality',
    scenario: 'scenario',
    enhanceDefinitions: 'enhanceDefinitions',
    nsfw: 'auxiliary', // ST的nsfw映射到auxiliary
    jailbreak: 'auxiliary',
    worldInfoAfter: 'worldInfoAfter',
    dialogueExamples: 'chatExamples',
    chatHistory: 'chatHistory',
  }
  return markerTypes[identifier] || 'custom'
}

function convertSTPromptItem(stPrompt: STPromptItem, index: number): PromptItem {
  const markerType = getMarkerTypeFromIdentifier(stPrompt.identifier)
  const isSystemMarker = ['main', 'worldInfoBefore', 'personaDescription', 'charDescription',
    'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'].includes(stPrompt.identifier)

  return {
    id: stPrompt.identifier || `prompt_${index}`,
    name: stPrompt.name,
    identifier: stPrompt.identifier,
    markerType,
    role: (stPrompt.role as PromptRole) || 'system',
    content: stPrompt.content || '',
    enabled: stPrompt.enabled ?? true,
    position: stPrompt.injection_position === 1 ? 'in-chat' : 'relative',
    depth: stPrompt.injection_depth ?? 0,
    order: index,
    triggers: ['normal', 'continue', 'impersonate', 'swipe', 'regenerate'],
    forbidOverrides: stPrompt.forbid_overrides ?? false,
    isSystem: isSystemMarker,
    marker: stPrompt.marker ?? false,
    injectionOrder: stPrompt.injection_order ?? 100,
    injectionTrigger: stPrompt.injection_trigger ?? [],
  }
}

function exportPromptItem(prompt: PromptItem): STPromptItem {
  return {
    identifier: prompt.identifier,
    name: prompt.name,
    system_prompt: prompt.role === 'system',
    enabled: prompt.enabled,
    marker: prompt.marker,
    role: prompt.role,
    content: prompt.content,
    injection_position: prompt.position === 'in-chat' ? 1 : 0,
    injection_depth: prompt.depth,
    forbid_overrides: prompt.forbidOverrides,
    injection_order: prompt.injectionOrder,
    injection_trigger: prompt.injectionTrigger,
  }
}

function convertSTPromptOrderEntry(entry: STPromptOrderEntry): PromptOrderEntry {
  return {
    characterId: entry.character_id,
    order: entry.order.map(item => ({
      identifier: item.identifier,
      enabled: item.enabled,
    })),
  }
}

function exportPromptOrderEntry(entry: PromptOrderEntry): STPromptOrderEntry {
  return {
    character_id: entry.characterId,
    order: entry.order.map(item => ({
      identifier: item.identifier,
      enabled: item.enabled,
    })),
  }
}

function convertSTRegexScript(script: STRegexScript): RegexScript {
  return {
    id: script.id,
    scriptName: script.scriptName,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: script.trimStrings || [],
    placement: script.placement as (1 | 2)[],
    disabled: script.disabled,
    markdownOnly: script.markdownOnly,
    promptOnly: script.promptOnly,
    runOnEdit: script.runOnEdit,
    substituteRegex: script.substituteRegex,
    minDepth: script.minDepth,
    maxDepth: script.maxDepth,
  }
}

function exportRegexScript(script: RegexScript): STRegexScript {
  return {
    id: script.id,
    scriptName: script.scriptName,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: script.trimStrings,
    placement: script.placement,
    disabled: script.disabled,
    markdownOnly: script.markdownOnly,
    promptOnly: script.promptOnly,
    runOnEdit: script.runOnEdit,
    substituteRegex: script.substituteRegex,
    minDepth: script.minDepth,
    maxDepth: script.maxDepth,
  }
}

// ============ 文件操作辅助函数 ============

/**
 * 解析 ST 预设 JSON 字符串
 */
export function parseSTPresetJSON(jsonString: string): STPresetJSON | null {
  try {
    return JSON.parse(jsonString) as STPresetJSON
  } catch {
    return null
  }
}

/**
 * 将预设导出为 JSON 字符串
 */
export function stringifySTPreset(preset: CompletionPresetData, pretty = true): string {
  const stPreset = exportSTPreset(preset)
  return pretty ? JSON.stringify(stPreset, null, 2) : JSON.stringify(stPreset)
}
