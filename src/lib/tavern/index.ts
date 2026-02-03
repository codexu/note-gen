// Character Import & Export
export {
  parseCharacterPng,
  parseCharacterPngs,
  selectCharacterFiles,
  importCharacter,
  importCharacters,
  selectAndImportCharacters,
  cardToV2Json,
  exportCharacterPng,
  selectAndExportCharacter,
  type PngParseResult,
  type CharacterCardData,
  type CharacterBook,
  type WorldInfoEntry,
  type RegexScript,
  type ImportResult,
} from './character-import'

// Template Engine
export {
  TavernTemplateEngine,
  processTemplate,
  parseExampleDialogue,
  type TemplateContext,
} from './template-engine'

// Context Builder
export {
  ContextBuilderV2 as TavernContextBuilder,
  buildContextV2 as buildContext,
  estimateTokens,
  type AIMessage,
  type ContextBuilderV2Config as ContextBuilderConfig,
  type ContextBuildResultV2 as ContextBuildResult,
  type ExtensionPrompt,
} from './context-builder-v2'

// AI Service (使用全局 AI 设置)
export {
  streamTavernResponse,
  fetchTavernResponse,
  checkAIServiceAvailable,
  streamTextCompletion,
  streamTavernResponseSmart,
  type TavernAIConfig,
} from './ai-service'

// Regex Processor
export {
  RegexProcessor,
  RegexPlacement,
  processAIOutput,
  processUserInput,
  processPrompt,
  BuiltInRegex,
  type RegexProcessorConfig,
} from './regex-processor'

// Preset Manager
export {
  // Import/Export
  importPresetFromFile,
  selectAndImportPreset,
  selectAndImportPresets,
  exportPreset,
  getPresetData,
  // Management
  getAllPresets,
  createDefaultContextPreset,
  duplicatePreset,
  updatePresetData,
  renamePreset,
  installBuiltinPresets,
  // Utilities
  detectPresetType,
  validateContextPreset,
  // Built-in templates
  BUILTIN_CONTEXT_TEMPLATES,
  // Types
  type STContextPreset,
  type STPreset,
  type PresetImportResult,
} from './preset-manager'

// Streaming Processor
export {
  StreamingProcessor,
  formatGenerationTimer,
  cleanUpMessage,
  addSwipe,
  switchSwipe,
  deleteSwipe,
  type GenerationType,
  type StreamingConfig,
  type StreamingState,
  type StreamingCallbacks,
} from './streaming'

// Group Chat
export {
  GroupChatManager,
  GroupGenerationMode,
  GroupActivationStrategy,
  // 别名保持兼容
  GroupActivationStrategy as ActivationStrategy,
  GroupGenerationMode as GroupGenerationType,
  createGroupChatManager,
  buildGroupContext,
  // 群组管理函数
  createGroup,
  getGroupWithMembers,
  addCharacterToGroup,
  removeCharacterFromGroup,
  toggleMemberActive,
  toggleMemberMuted,
  updateMemberOrder,
  reorderMembers,
  getGroups,
  deleteGroup,
  // 类型
  type GroupMemberWithCard,
  type GroupChatContext,
  type CombinedCharacterCard,
  type GroupContextConfig,
  type AutoModeState,
  type GroupSettings,
} from './group-chat-v2'

// Prompt Manager
export {
  PromptManager,
  InjectionPosition,
  DEFAULT_PROMPTS,
  DEFAULT_PROMPT_ORDER,
  createDefaultPromptManagerConfig,
  validatePromptManagerConfig,
  type PromptEntry,
  type PromptOrderEntry,
  type PromptManagerConfig,
  type PromptRole,
  type DynamicContentProvider,
} from './prompt-manager'

// World Info Scanner
export {
  WorldInfoScanner,
  SelectiveLogic,
  ScanState,
  DEFAULT_SCAN_CONFIG,
  createTimedEffectsState,
  serializeTimedEffects,
  deserializeTimedEffects,
  type TimedEffectType,
  type TimedEffect,
  type TimedEffectsState,
  type WorldInfoScanConfig,
  type WorldInfoScanResult,
} from './world-info-scanner'

// Chat Completion (ST-style context management)
export {
  ChatCompletion,
  MessageCollection,
  InjectionPosition as ChatInjectionPosition,
  createMessage,
  createCollection,
  type ChatMessage as ChatCompletionMessage,
  type DepthInjection,
} from './chat-completion'


// Context Integration (统一上下文构建接口)
export {
  buildUnifiedContext,
  buildTavernContext,
  collectExtensionPrompts,
  getPromptOrder,
  parseStoppingStrings,
  type ContextBuildOptions,
  type UnifiedBuildResult,
} from './context-integration'

