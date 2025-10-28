import {
  BotMessageSquare,
  LayoutTemplate,
  ScanText,
  Store,
  UserRoundCog,
  Drama,
  FolderOpen,
  Package,
  Database,
  DatabaseBackup,
  ImageUp,
  FileCog,
  Book,
  KeyboardIcon,
  Volume2,
  Settings,
  Puzzle
} from "lucide-react"

const baseConfig = [
  {
    icon: <Store className="size-4 md:size-6" />,
    anchor: 'about',
  },
  {
    icon: <Settings className="size-4 md:size-6" />,
    anchor: 'general',
  },
  '-',
  {
    icon: <DatabaseBackup className="size-4 md:size-6" />,
    anchor: 'sync',
  },
  {
    icon: <ImageUp className="size-4 md:size-6" />,
    anchor: 'imageHosting',
  },
  {
    icon: <Database className="size-4 md:size-6" />,
    anchor: 'backupSync',
  },
  '-',
  {
    icon: <BotMessageSquare className="size-4 md:size-6" />,
    anchor: 'ai',
  },
  {
    icon: <Package className="size-4 md:size-6" />,
    anchor: 'defaultModel',
  },
  {
    icon: <Book className="size-4 md:size-6" />,
    anchor: 'rag',
  },
  {
    icon: <Puzzle className="size-4 md:size-6" />,
    anchor: 'mcp',
  },
  {
    icon: <Drama className="size-4 md:size-6" />,
    anchor: 'prompt',
  },
  {
    icon: <LayoutTemplate className="size-4 md:size-6" />,
    anchor: 'template',
  },
  '-',
  {
    icon: <FolderOpen className="size-4 md:size-6" />,
    anchor: 'file',
  },
  {
    icon: <FileCog className="size-4 md:size-6" />,
    anchor: 'editor',
  },
  {
    icon: <KeyboardIcon className="size-4 md:size-6" />,
    anchor: 'shortcuts',
  },
  {
    icon: <ScanText className="size-4 md:size-6" />,
    anchor: 'imageMethod',
  },
  {
    icon: <Volume2 className="size-4 md:size-6" />,
    anchor: 'audio',
  },
  '-',
  {
    icon: <UserRoundCog className="size-4 md:size-6" />,
    anchor: 'dev',
  }
]

export default baseConfig

export type ModelType = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'rerank';

export interface ModelConfig {
  id: string
  model: string
  modelType: ModelType
  temperature?: number
  topP?: number
  voice?: string
  enableStream?: boolean
}

export interface AiConfig {
  key: string
  title: string
  apiKey?: string
  baseURL?: string
  icon?: string
  apiKeyUrl?: string
  customHeaders?: Record<string, string>
  models?: ModelConfig[]
  // 保持向后兼容
  model?: string
  temperature?: number
  topP?: number
  modelType?: ModelType
  voice?: string
  speed?: number
  enableStream?: boolean
}

export interface Model {
  id: string
  object: string
  created: number
  owned_by: string
}

// Define base AI configuration without translations
const baseAiConfig: AiConfig[] = [
  {
    key: 'siliconflow',
    title: 'SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    icon: 'https://s2.loli.net/2025/09/09/D8Al2raSvewN5xn.jpg',
    apiKeyUrl: 'https://cloud.siliconflow.cn/i/O2ciJeZw'
  },
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
    key: 'grok',
    title: 'Grok',
    baseURL: 'https://api.x.ai/v1',
    icon: 'https://s2.loli.net/2025/06/25/JBZMluaobKq43QE.png',
    apiKeyUrl: 'https://console.x.ai/'
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
    key: 'deepseek',
    title: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    icon: 'https://s2.loli.net/2025/06/25/n39WmsCDbVLQzjr.png',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys'
  },
  {
    key: 'openrouter',
    title: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    icon: 'https://s2.loli.net/2025/06/25/CTjSDHLl4XdvxM5.png',
    apiKeyUrl: 'https://openrouter.ai/api-keys'
  },
  {
    key: 'qiniu',
    title: '七牛云',
    baseURL: 'https://openai.qiniu.com/v1',
    icon: 'https://s2.loli.net/2025/09/15/ALjNPveWrtmsfOY.png',
    apiKeyUrl: 'https://s.qiniu.com/Znm6je'
  },
  {
    key: '302',
    title: '302.AI',
    baseURL: 'https://api.302.ai/v1',
    icon: 'https://s2.loli.net/2025/06/26/4CJOQ2U9ibvoGpR.png',
    apiKeyUrl: 'https://share.302.ai/jfFrIP'
  },
  {
    key: 'shengsuanyun',
    title: '胜算云',
    baseURL: 'https://router.shengsuanyun.com/api/v1',
    icon: 'https://s2.loli.net/2025/09/15/4qjswKyaRfZ8OxW.png',
    apiKeyUrl: 'https://www.shengsuanyun.com/?from=CH_KAFLGC9O'
  },
  {
    key: 'gitee',
    title: 'Gitee AI',
    baseURL: 'https://ai.gitee.com/v1',
    icon: 'https://s2.loli.net/2025/09/15/ih7aTnGPvELFsVc.png',
    apiKeyUrl: 'https://ai.gitee.com/'
  },
]

export { baseAiConfig }