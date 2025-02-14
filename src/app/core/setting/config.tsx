import { BotMessageSquare, LayoutTemplate, Command, FileUp, Palette, ScanText, Store, UserRoundCog, Languages } from "lucide-react"
import { SettingAbout } from "./setting-about"
import { SettingAI } from "./setting-ai"
import { SettingSync } from "./setting-sync"
import { SettingOCR } from "./setting-ocr"
import { SettingShortcut } from "./setting-shortcut"
import { SettingTheme } from "./setting-theme"
import { SettingDev } from "./setting-dev"
import { SettingTemplate } from "./setting-template"
import { SettingLocale } from "./setting-locale"
import { _t } from '@/locales/index';

const config = [
  {
    title: _t('about'),
    icon: <Store />,
    anchor: 'about',
    children: SettingAbout,
  },
  {
    title: _t('ai'),
    icon: <BotMessageSquare />,
    anchor: 'ai',
    children: SettingAI,
  },
  {
    title: _t('sync'),
    icon: <FileUp />,
    anchor: 'sync',
    children: SettingSync,
  },
  {
    title: _t('ocr'),
    icon: <ScanText />,
    anchor: 'ocr',
    children: SettingOCR,
  },
  {
    title: _t('template_settings_title'),
    icon: <LayoutTemplate />,
    anchor: 'template',
    children: SettingTemplate,
  },
  {
    title: _t('shortcut'),
    icon: <Command />,
    anchor: 'shortcut',
    children: SettingShortcut,
  },
  {
    title: _t('theme'),
    icon: <Palette />,
    anchor: 'theme',
    children: SettingTheme,
  },
  {
    title: _t('language'),
    icon: <Languages />,
    anchor: 'language',
    children: SettingLocale,
  },
  {
    title: _t('developer'),
    icon: <UserRoundCog />,
    anchor: 'dev',
    children: SettingDev,
  },
]

export default config

export interface AiConfig {
  key: string
  title: string
  baseURL?: string
  modelURL?: string
}

export interface Model {
  id: string
  object: string
  created: number
  owned_by: string
}

const aiConfig = [
  {
    key: 'custom',
    title: _t('custom'),
    baseURL: null,
  },
  {
    key: 'chatgpt',
    title: 'ChatGPT',
    baseURL: 'https://api.openai.com/v1',
    modelURL: 'https://api.openai.com/v1/models',
  },
  {
    key: 'chatanywhere',
    title: 'ChatAnyWhere',
    baseURL: 'https://api.chatanywhere.tech/v1',
    modelURL: 'https://api.chatanywhere.tech/v1/models',
  },
  {
    key: 'ollama',
    title: 'Ollama',
    baseURL: 'http://localhost:11434',
    modelURL: 'http://localhost:11434/v1/models',
  },
  {
    key: 'lmstudio',
    title: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    modelURL: 'http://localhost:1234/v1/models',
  },
  {
    key: 'volcengine',
    title: '豆包',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  {
    key: 'aliyun',
    title: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
  },
  {
    key: 'moonshot',
    title: 'Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    modelURL: 'https://api.moonshot.cn/v1/models',
  },
  {
    key: 'deepseek',
    title: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    modelURL: 'https://api.deepseek.com/models',
  },
]

export { aiConfig }
