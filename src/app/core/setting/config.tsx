import {
  BotMessageSquare,
  LayoutTemplate,
  ScanText,
  Store,
  Drama,
  FolderOpen,
  DatabaseBackup,
  ArchiveRestore,
  ImageUp,
  FileCog,
  Book,
  KeyboardIcon,
  Volume2,
  Settings,
  Puzzle,
  Sparkles,
  PenTool,
  Brain,
  Globe2,
  Palette,
  Blocks,
} from "lucide-react"
import type { ReactNode } from 'react'
import type { BuiltinSettingSection } from '@/stores/settings-dialog'

export type SettingNavigationGroup =
  | 'basic'
  | 'ai'
  | 'data'
  | 'extensions'

export type SettingNavigationItem =
  | {
      icon: ReactNode
      anchor: BuiltinSettingSection
    }
  | {
      group: SettingNavigationGroup
    }

const baseConfig: SettingNavigationItem[] = [
  {
    group: 'basic',
  },
  {
    icon: <Store className="size-4" />,
    anchor: 'about',
  },
  {
    icon: <Settings className="size-4" />,
    anchor: 'general',
  },
  {
    icon: <PenTool className="size-4" />,
    anchor: 'record',
  },
  {
    icon: <FileCog className="size-4" />,
    anchor: 'editor',
  },
  {
    icon: <Palette className="size-4" />,
    anchor: 'canvas',
  },
  {
    icon: <KeyboardIcon className="size-4" />,
    anchor: 'shortcuts',
  },
  {
    icon: <ScanText className="size-4" />,
    anchor: 'imageMethod',
  },
  {
    icon: <Volume2 className="size-4" />,
    anchor: 'audio',
  },
  {
    group: 'ai',
  },
  {
    icon: <BotMessageSquare className="size-4" />,
    anchor: 'ai',
  },
  {
    icon: <Globe2 className="size-4" />,
    anchor: 'webSearch',
  },
  {
    icon: <Book className="size-4" />,
    anchor: 'rag',
  },
  {
    icon: <Brain className="size-4" />,
    anchor: 'memories',
  },
  {
    icon: <Drama className="size-4" />,
    anchor: 'prompt',
  },
  {
    icon: <Puzzle className="size-4" />,
    anchor: 'mcp',
  },
  {
    icon: <Sparkles className="size-4" />,
    anchor: 'skills',
  },
  {
    icon: <LayoutTemplate className="size-4" />,
    anchor: 'template',
  },
  {
    group: 'data',
  },
  {
    icon: <DatabaseBackup className="size-4" />,
    anchor: 'sync',
  },
  {
    icon: <ArchiveRestore className="size-4" />,
    anchor: 'backup',
  },
  {
    icon: <ImageUp className="size-4" />,
    anchor: 'imageHosting',
  },
  {
    icon: <FolderOpen className="size-4" />,
    anchor: 'file',
  },
  {
    group: 'extensions',
  },
  {
    icon: <Blocks className="size-4" />,
    anchor: 'plugins',
  },
]

export default baseConfig

export type ModelType = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'rerank';
export type ProxyMode = 'inherit' | 'direct' | 'custom';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type WebSearchProvider = 'auto' | 'zhipu' | 'tavily' | 'brave' | 'exa';
export type WebSearchApiProvider = Exclude<WebSearchProvider, 'auto'>;
export type WebSearchApiKeys = Partial<Record<WebSearchApiProvider, string>>;

export type ModelInputModality = 'text' | 'image' | 'video'
export type ModelThinkingMode = 'adaptive' | 'disabled' | 'always_on'

export interface ModelPricing {
  input: number
  output: number
  cacheRead: number
  cacheWrite?: number
}

export interface ProviderEndpoint {
  region: 'global_en' | 'cn_zh'
  protocol: 'openai' | 'anthropic'
  baseURL: string
  docsURL: string
}

export interface ModelConfig {
  id: string
  model: string
  modelType: ModelType
  temperature?: number
  topP?: number
  voice?: string
  enableStream?: boolean
  pricing?: ModelPricing
  inputModalities?: ModelInputModality[]
  thinking?: ModelThinkingMode[]
  maxOutputTokens?: number
  maxTokens?: number
  contextWindow?: number
  tokenLimitParam?: 'max_completion_tokens' | 'max_tokens'
  enableWebSearch?: boolean
  enableNativeWebSearch?: boolean
  enableThirdPartyWebSearch?: boolean
  enableBasicWebSearch?: boolean
  webSearchProvider?: WebSearchProvider
  webSearchApiKey?: string
  webSearchApiKeys?: WebSearchApiKeys
  webSearchProviderOrder?: WebSearchApiProvider[]
}

export interface AiConfig {
  key: string
  title: string
  apiKey?: string
  baseURL?: string
  templateKey?: string
  templateSource?: 'builtin' | 'remote' | 'custom'
  icon?: string
  apiKeyUrl?: string
  promotion?: string
  sponsored?: boolean
  customHeaders?: Record<string, string>
  endpoints?: ProviderEndpoint[]
  proxyMode?: ProxyMode
  proxyURL?: string
  models?: ModelConfig[]
  // 保持向后兼容
  model?: string
  temperature?: number
  topP?: number
  modelType?: ModelType
  voice?: string
  speed?: number
  enableStream?: boolean
  maxTokens?: number
  contextWindow?: number
  tokenLimitParam?: 'max_completion_tokens' | 'max_tokens'
  // Runtime-only override captured when sending a chat turn.
  reasoningEffort?: ReasoningEffort
  enableWebSearch?: boolean
  enableNativeWebSearch?: boolean
  enableThirdPartyWebSearch?: boolean
  enableBasicWebSearch?: boolean
  webSearchProvider?: WebSearchProvider
  webSearchApiKey?: string
  webSearchApiKeys?: WebSearchApiKeys
  webSearchProviderOrder?: WebSearchApiProvider[]
}

export interface Model {
  id: string
  object: string
  created: number
  owned_by: string
}

// Define base AI configuration without translations
const builtinProviderTemplates: AiConfig[] = [
  {
    key: 'chatgpt',
    title: 'ChatGPT',
    baseURL: 'https://api.openai.com/v1',
    icon: 'https://s2.loli.net/2025/06/25/cVMf586WTBYAju4.png',
    apiKeyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    key: 'gemini',
    title: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    icon: 'https://s2.loli.net/2025/06/25/JU2jVxLFsW4lB6S.png',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    key: 'ollama',
    title: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    icon: 'https://s2.loli.net/2025/06/25/legkEpHACDBQ5Xz.png',
  },
  {
    key: 'lmstudio',
    title: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    icon: 'https://s2.loli.net/2025/06/25/IifFV4HTQ9dpGZE.png',
  },

  {
    key: 'minimax',
    title: 'MiniMax',
    baseURL: 'https://api.minimax.io/v1',
    icon: 'https://filecdn.minimax.chat/public/c5b4442f-ab8b-4d97-9119-8504670b0097.png',
    apiKeyUrl: 'https://platform.minimax.io/',
    endpoints: [
      { region: 'global_en', protocol: 'openai', baseURL: 'https://api.minimax.io/v1', docsURL: 'https://platform.minimax.io/docs' },
      { region: 'global_en', protocol: 'anthropic', baseURL: 'https://api.minimax.io/anthropic', docsURL: 'https://platform.minimax.io/docs' },
      { region: 'cn_zh', protocol: 'openai', baseURL: 'https://api.minimaxi.com/v1', docsURL: 'https://platform.minimaxi.com/docs' },
      { region: 'cn_zh', protocol: 'anthropic', baseURL: 'https://api.minimaxi.com/anthropic', docsURL: 'https://platform.minimaxi.com/docs' },
    ],
    models: [
      {
        id: 'minimax-MiniMax-M3',
        model: 'MiniMax-M3',
        modelType: 'chat',
        temperature: 0.7,
        topP: 1,
        enableStream: true,
        contextWindow: 1_000_000,
        pricing: { input: 0.6, output: 2.4, cacheRead: 0.12 },
        inputModalities: ['text', 'image', 'video'],
        thinking: ['adaptive', 'disabled'],
      },
      {
        id: 'minimax-MiniMax-M2.7',
        model: 'MiniMax-M2.7',
        modelType: 'chat',
        temperature: 0.7,
        topP: 1,
        enableStream: true,
        contextWindow: 204_800,
        pricing: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
        inputModalities: ['text'],
        thinking: ['always_on'],
      },
      { id: 'minimax-MiniMax-M2.7-highspeed', model: 'MiniMax-M2.7-highspeed', modelType: 'chat', temperature: 0.7, topP: 1, enableStream: true },
    ],
  },
]

const baseAiConfig = builtinProviderTemplates

export { baseAiConfig, builtinProviderTemplates }
