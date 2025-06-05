import { BotMessageSquare, LayoutTemplate, FileUp, Palette, ScanText, Store, UserRoundCog, Drama, FolderOpen, Package } from "lucide-react"

const baseConfig = [
  {
    icon: <Store />,
    anchor: 'about',
  },
  {
    icon: <BotMessageSquare />,
    anchor: 'ai',
  },
  {
    icon: <Package />,
    anchor: 'defaultModel',
  },
  {
    icon: <Drama />,
    anchor: 'prompt',
  },
  {
    icon: <LayoutTemplate />,
    anchor: 'template',
  },
  {
    icon: <FileUp />,
    anchor: 'sync',
  },
  {
    icon: <FolderOpen />,
    anchor: 'file',
  },
  {
    icon: <ScanText />,
    anchor: 'ocr',
  },
  {
    icon: <Palette />,
    anchor: 'theme',
  },
  {
    icon: <UserRoundCog />,
    anchor: 'dev',
  }
]

export default baseConfig

export type ModelType = 'chat' | 'image' | 'video' | 'audio' | 'embedding' | 'rerank';

export interface AiConfig {
  key: string
  title: string
  type: 'built-in' | 'custom'
  temperature: number
  topP: number
  apiKey?: string
  model?: string
  baseURL?: string
  modelType?: ModelType
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
    key: 'chatgpt',
    title: 'ChatGPT',
    type: 'built-in',
    temperature: 0.7,
    topP: 1.0,
    baseURL: 'https://api.openai.com/v1',
    modelType: 'chat',
  },
  {
    key: 'gemini',
    title: 'Gemini',
    type: 'built-in',
    temperature: 0.7,
    topP: 1.0,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    modelType: 'chat',
  },
  {
    key: 'grok',
    title: 'Grok',
    type: 'built-in',
    temperature: 0.7,
    topP: 1.0,
    baseURL: 'https://api.x.ai/v1',
    modelType: 'chat',
  },
  {
    key: 'ollama',
    title: 'Ollama',
    type: 'built-in',
    baseURL: 'http://localhost:11434/v1',
    temperature: 0.7,
    topP: 1.0,
    modelType: 'chat',
  },
  {
    key: 'lmstudio',
    title: 'LM Studio',
    type: 'built-in',
    temperature: 0.7,
    topP: 1.0,
    baseURL: 'http://localhost:1234/v1',
    modelType: 'chat',
  },
  {
    key: 'deepseek',
    title: 'DeepSeek',
    type: 'built-in',
    temperature: 0.7,
    topP: 1.0,
    baseURL: 'https://api.deepseek.com',
    modelType: 'chat',
  },
  {
    key: 'openrouter',
    title: 'OpenRouter',
    type: 'built-in',
    temperature: 0.7,
    topP: 1.0,
    baseURL: 'https://openrouter.ai/api/v1',
    modelType: 'chat',
  },
  {
    key: 'siliconflow',
    title: 'SiliconFlow',
    type: 'built-in',
    temperature: 0.7,
    topP: 1.0,
    baseURL: 'https://api.siliconflow.cn/v1',
    modelType: 'chat',
  },
]

export { baseAiConfig }