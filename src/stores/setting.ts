import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { getVersion } from '@tauri-apps/api/app'
import { AiConfig } from '@/app/core/setting/config'
import { GitlabInstanceType } from '@/lib/gitlab.types'
import { noteGenDefaultModels, noteGenModelKeys } from '@/app/model-config'

export enum GenTemplateRange {
  All = 'all',
  Today = 'today',
  Week = 'week',
  Month = 'month',
  ThreeMonth = 'threeMonth',
  Year = 'year',
}

export interface GenTemplate {
  id: string
  title: string
  status: boolean
  content: string
  range: GenTemplateRange
}

interface SettingState {
  initSettingData: () => Promise<void>

  version: string
  setVersion: () => Promise<void>

  autoUpdate: boolean
  setAutoUpdate: (autoUpdate: boolean) => void

  language: string
  setLanguage: (language: string) => void

  // setting - ai - 当前选择的模型 key
  currentAi: string
  setCurrentAi: (currentAi: string) => void

  aiModelList: AiConfig[]
  setAiModelList: (aiModelList: AiConfig[]) => void

  primaryModel: string
  setPrimaryModel: (primaryModel: string) => void

  placeholderModel: string
  setPlaceholderModel: (placeholderModel: string) => Promise<void>

  translateModel: string
  setTranslateModel: (translateModel: string) => Promise<void>

  markDescModel: string
  setMarkDescModel: (markDescModel: string) => Promise<void>

  embeddingModel: string
  setEmbeddingModel: (embeddingModel: string) => Promise<void>

  rerankingModel: string
  setRerankingModel: (rerankingModel: string) => Promise<void>

  imageMethodModel: string
  setImageMethodModel: (imageMethodModel: string) => Promise<void>

  audioModel: string
  setAudioModel: (audioModel: string) => Promise<void>

  templateList: GenTemplate[]
  setTemplateList: (templateList: GenTemplate[]) => Promise<void>

  darkMode: string
  setDarkMode: (darkMode: string) => void

  previewTheme: string
  setPreviewTheme: (previewTheme: string) => void

  codeTheme: string
  setCodeTheme: (codeTheme: string) => void

  tesseractList: string
  setTesseractList: (tesseractList: string) => void

  // Github 相关设置
  githubUsername: string
  setGithubUsername: (githubUsername: string) => Promise<void>

  accessToken: string
  setAccessToken: (accessToken: string) => void

  jsdelivr: boolean
  setJsdelivr: (jsdelivr: boolean) => void

  useImageRepo: boolean
  setUseImageRepo: (useImageRepo: boolean) => Promise<void>

  autoSync: string
  setAutoSync: (autoSync: string) => Promise<void>

  // Gitee 相关设置
  giteeAccessToken: string
  setGiteeAccessToken: (giteeAccessToken: string) => void

  giteeAutoSync: string
  setGiteeAutoSync: (giteeAutoSync: string) => Promise<void>

  // Gitlab 相关设置
  gitlabInstanceType: GitlabInstanceType
  setGitlabInstanceType: (instanceType: GitlabInstanceType) => Promise<void>

  gitlabCustomUrl: string
  setGitlabCustomUrl: (customUrl: string) => Promise<void>

  gitlabAccessToken: string
  setGitlabAccessToken: (gitlabAccessToken: string) => void

  gitlabAutoSync: string
  setGitlabAutoSync: (gitlabAutoSync: string) => Promise<void>

  gitlabUsername: string
  setGitlabUsername: (gitlabUsername: string) => Promise<void>

  // 主要备份方式设置
  primaryBackupMethod: 'github' | 'gitee' | 'gitlab'
  setPrimaryBackupMethod: (method: 'github' | 'gitee' | 'gitlab') => Promise<void>

  lastSettingPage: string
  setLastSettingPage: (page: string) => Promise<void>

  workspacePath: string
  setWorkspacePath: (path: string) => Promise<void>

  // 工作区历史路径
  workspaceHistory: string[]
  addWorkspaceHistory: (path: string) => Promise<void>
  removeWorkspaceHistory: (path: string) => Promise<void>
  clearWorkspaceHistory: () => Promise<void>

  assetsPath: string
  setAssetsPath: (path: string) => Promise<void>

  // 图床设置
  githubImageAccessToken: string
  setGithubImageAccessToken: (githubImageAccessToken: string) => Promise<void>

  // 自定义仓库名称设置
  githubCustomSyncRepo: string
  setGithubCustomSyncRepo: (repo: string) => Promise<void>

  giteeCustomSyncRepo: string
  setGiteeCustomSyncRepo: (repo: string) => Promise<void>

  gitlabCustomSyncRepo: string
  setGitlabCustomSyncRepo: (repo: string) => Promise<void>

  githubCustomImageRepo: string
  setGithubCustomImageRepo: (repo: string) => Promise<void>

  // 图片识别设置
  primaryImageMethod: 'ocr' | 'vlm'
  setPrimaryImageMethod: (method: 'ocr' | 'vlm') => Promise<void>

  // 界面缩放设置
  uiScale: number
  setUiScale: (scale: number) => Promise<void>
}


const useSettingStore = create<SettingState>((set, get) => ({
  initSettingData: async () => {
    const store = await Store.load('store.json');
    await get().setVersion()
    
    // 初始化默认的NoteGen模型配置
    const existingAiModelList = (await store.get('aiModelList') as AiConfig[]) || []
    const hasNoteGenModels = existingAiModelList.some(model => 
      noteGenModelKeys.includes(model.key)
    )
    
    let finalAiModelList = existingAiModelList
    if (!hasNoteGenModels) {
      finalAiModelList = [...existingAiModelList, ...noteGenDefaultModels]
      await store.set('aiModelList', finalAiModelList)
      set({ aiModelList: finalAiModelList })
    }

    // 检查是否设置了主要模型，如果没有且存在note-gen-chat，则设置为主要模型
    const currentPrimaryModel = await store.get('primaryModel') as string
    const hasNoteGenChat = finalAiModelList.some(model => model.key === 'note-gen-chat')
    
    if (!currentPrimaryModel && hasNoteGenChat) {
      await store.set('primaryModel', 'note-gen-chat')
      set({ primaryModel: 'note-gen-chat' })
    }

    // 检查是否设置了嵌入模型，如果没有且存在note-gen-embedding，则设置为默认嵌入模型
    const currentEmbeddingModel = await store.get('embeddingModel') as string
    const hasNoteGenEmbedding = finalAiModelList.some(model => model.key === 'note-gen-embedding')
    
    if (!currentEmbeddingModel && hasNoteGenEmbedding) {
      await store.set('embeddingModel', 'note-gen-embedding')
      set({ embeddingModel: 'note-gen-embedding' })
    }

    // 检查是否设置了视觉语言模型，如果没有且存在note-gen-vlm，则设置为默认视觉语言模型
    const currentImageMethodModel = await store.get('imageMethodModel') as string
    const hasNoteGenVlm = finalAiModelList.some(model => model.key === 'note-gen-vlm')
    
    if (!currentImageMethodModel && hasNoteGenVlm) {
      await store.set('imageMethodModel', 'note-gen-vlm')
      set({ imageMethodModel: 'note-gen-vlm' })
    }

    Object.entries(get()).forEach(async ([key, value]) => {
      const res = await store.get(key)

      if (typeof value === 'function') return
      if (res !== undefined && key !== 'version') {
        if (key === 'templateList') {
          set({ [key]: [] })
          setTimeout(() => {
            set({ [key]: res as GenTemplate[] })
          }, 0);
        } else if (key === 'aiModelList' && hasNoteGenModels) {
          // 如果已经有NoteGen模型，使用存储的配置
          set({ [key]: res as AiConfig[] })
        } else if (key !== 'aiModelList') {
          set({ [key]: res })
        }
      } else {
        await store.set(key, value)
      }
    })
  },

  version: '',
  setVersion: async () => {
    const version = await getVersion()
    set({ version })
  },

  autoUpdate: true,
  setAutoUpdate: (autoUpdate) => set({ autoUpdate }),

  language: '简体中文',
  setLanguage: (language) => set({ language }),

  currentAi: '',
  setCurrentAi: (currentAi) => set({ currentAi }),

  aiModelList: [],
  setAiModelList: (aiModelList) => set({ aiModelList }),

  primaryModel: '',
  setPrimaryModel: (primaryModel) => set({ primaryModel }),

  placeholderModel: '',
  setPlaceholderModel: async (placeholderModel) => {
    const store = await Store.load('store.json');
    await store.set('placeholderModel', placeholderModel)
    set({ placeholderModel })
  },

  translateModel: '',
  setTranslateModel: async (translateModel) => {
    const store = await Store.load('store.json');
    await store.set('translateModel', translateModel)
    set({ translateModel })
  },

  markDescModel: '',
  setMarkDescModel: async (markDescModel) => {
    const store = await Store.load('store.json');
    await store.set('markDescModel', markDescModel)
    set({ markDescModel })
  },

  embeddingModel: '',
  setEmbeddingModel: async (embeddingModel) => {
    const store = await Store.load('store.json');
    await store.set('embeddingModel', embeddingModel)
    set({ embeddingModel })
  },

  rerankingModel: '',
  setRerankingModel: async (rerankingModel) => {
    const store = await Store.load('store.json');
    await store.set('rerankingModel', rerankingModel)
    set({ rerankingModel })
  },

  imageMethodModel: '',
  setImageMethodModel: async (imageMethodModel) => {
    const store = await Store.load('store.json');
    await store.set('imageMethodModel', imageMethodModel)
    set({ imageMethodModel })
  },

  audioModel: '',
  setAudioModel: async (audioModel) => {
    const store = await Store.load('store.json');
    await store.set('audioPrimaryModel', audioModel)
    set({ audioModel })
  },

  templateList: [
    {
      id: '0',
      title: '笔记',
      content: `整理成一篇详细完整的笔记。
满足以下格式要求：
- 如果是代码，必须完整保留，不要随意生成。
- 文字复制的内容尽量不要修改，只处理格式化后的内容。`,
      status: true,
      range: GenTemplateRange.All
    },
    {
      id: '1',
      title: '周报',
      content: '最近一周的记录整理成一篇周报，将每条记录形成一句总结，每条不超过50字。',
      status: true,
      range: GenTemplateRange.Week
    }
  ],
  setTemplateList: async (templateList) => {
    set({ templateList })
    const store = await Store.load('store.json')
    await store.set('templateList', templateList)
  },

  darkMode: 'system',
  setDarkMode: (darkMode) => set({ darkMode }),

  previewTheme: 'github',
  setPreviewTheme: (previewTheme) => set({ previewTheme }),

  codeTheme: 'github',
  setCodeTheme: (codeTheme) => set({ codeTheme }),

  tesseractList: 'eng,chi_sim',
  setTesseractList: (tesseractList) => set({ tesseractList }),

  githubUsername: '',
  setGithubUsername: async (githubUsername) => {
    set({ githubUsername })
    const store = await Store.load('store.json');
    store.set('githubUsername', githubUsername)
  },

  accessToken: '',
  setAccessToken: async (accessToken) => {
    const store = await Store.load('store.json');
    const hasAccessToken = await store.get('accessToken') === accessToken
    if (!hasAccessToken) {
      await get().setGithubUsername('')
    }
    set({ accessToken })
  },

  jsdelivr: true,
  setJsdelivr: async (jsdelivr: boolean) => {
    set({ jsdelivr })
    const store = await Store.load('store.json');
    await store.set('jsdelivr', jsdelivr)
  },

  useImageRepo: false,
  setUseImageRepo: async (useImageRepo: boolean) => {
    set({ useImageRepo })
    const store = await Store.load('store.json');
    await store.set('useImageRepo', useImageRepo)
  },

  autoSync: 'disabled',
  setAutoSync: async (autoSync: string) => {
    set({ autoSync })
    const store = await Store.load('store.json');
    await store.set('autoSync', autoSync)
  },

  lastSettingPage: 'ai',
  setLastSettingPage: async (page: string) => {
    set({ lastSettingPage: page })
    const store = await Store.load('store.json');
    await store.set('lastSettingPage', page)
  },

  workspacePath: '',
  setWorkspacePath: async (path: string) => {
    set({ workspacePath: path })
    const store = await Store.load('store.json');
    await store.set('workspacePath', path)
    
    // 如果路径不为空且不在历史记录中，则添加到历史记录
    if (path && !get().workspaceHistory.includes(path)) {
      await get().addWorkspaceHistory(path)
    }
  },

  // 工作区历史路径管理
  workspaceHistory: [],
  addWorkspaceHistory: async (path: string) => {
    const currentHistory = get().workspaceHistory
    const newHistory = [path, ...currentHistory.filter(p => p !== path)].slice(0, 10) // 最多保存10个历史路径
    set({ workspaceHistory: newHistory })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', newHistory)
    await store.save()
  },
  removeWorkspaceHistory: async (path: string) => {
    const newHistory = get().workspaceHistory.filter(p => p !== path)
    set({ workspaceHistory: newHistory })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', newHistory)
    await store.save()
  },
  clearWorkspaceHistory: async () => {
    set({ workspaceHistory: [] })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', [])
    await store.save()
  },

  // Gitee 相关设置
  giteeAccessToken: '',
  setGiteeAccessToken: async (giteeAccessToken: string) => {
    set({ giteeAccessToken })
    const store = await Store.load('store.json');
    await store.set('giteeAccessToken', giteeAccessToken)
  },

  giteeAutoSync: 'disabled',
  setGiteeAutoSync: async (giteeAutoSync: string) => {
    set({ giteeAutoSync })
    const store = await Store.load('store.json');
    await store.set('giteeAutoSync', giteeAutoSync)
  },

  // Gitlab 相关设置
  gitlabInstanceType: GitlabInstanceType.OFFICIAL,
  setGitlabInstanceType: async (instanceType: GitlabInstanceType) => {
    const store = await Store.load('store.json')
    await store.set('gitlabInstanceType', instanceType)
    await store.save()
    set({ gitlabInstanceType: instanceType })
  },

  gitlabCustomUrl: '',
  setGitlabCustomUrl: async (customUrl: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabCustomUrl', customUrl)
    await store.save()
    set({ gitlabCustomUrl: customUrl })
  },

  gitlabAccessToken: '',
  setGitlabAccessToken: (gitlabAccessToken: string) => {
    set({ gitlabAccessToken })
  },

  gitlabAutoSync: 'disabled',
  setGitlabAutoSync: async (gitlabAutoSync: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabAutoSync', gitlabAutoSync)
    await store.save()
    set({ gitlabAutoSync })
  },

  gitlabUsername: '',
  setGitlabUsername: async (gitlabUsername: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabUsername', gitlabUsername)
    await store.save()
    set({ gitlabUsername })
  },

  // 默认使用 GitHub 作为主要备份方式
  primaryBackupMethod: 'github',
  setPrimaryBackupMethod: async (method: 'github' | 'gitee' | 'gitlab') => {
    const store = await Store.load('store.json')
    await store.set('primaryBackupMethod', method)
    await store.save()
    set({ primaryBackupMethod: method })
  },

  assetsPath: 'assets',
  setAssetsPath: async (path: string) => {
    set({ assetsPath: path })
    const store = await Store.load('store.json');
    await store.set('assetsPath', path)
    await store.save()
  },

  // 图床设置
  githubImageAccessToken: '',
  setGithubImageAccessToken: async (githubImageAccessToken: string) => {
    set({ githubImageAccessToken })
    const store = await Store.load('store.json');
    await store.set('githubImageAccessToken', githubImageAccessToken)
    await store.save()
  },

  // 图片识别设置
  primaryImageMethod: 'ocr',
  setPrimaryImageMethod: async (method: 'ocr' | 'vlm') => {
    set({ primaryImageMethod: method })
    const store = await Store.load('store.json');
    await store.set('primaryImageMethod', method)
    await store.save()
  },

  // 界面缩放设置 (75%, 100%, 125%, 150%)
  uiScale: 100,
  setUiScale: async (scale: number) => {
    set({ uiScale: scale })
    const store = await Store.load('store.json');
    await store.set('uiScale', scale)
    await store.save()
    
    // 使用fontSize实现基于rem的缩放
    document.documentElement.style.fontSize = `${scale}%`
  },

  // 自定义仓库名称设置
  githubCustomSyncRepo: '',
  setGithubCustomSyncRepo: async (repo: string) => {
    set({ githubCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('githubCustomSyncRepo', repo)
    await store.save()
  },

  giteeCustomSyncRepo: '',
  setGiteeCustomSyncRepo: async (repo: string) => {
    set({ giteeCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('giteeCustomSyncRepo', repo)
    await store.save()
  },

  gitlabCustomSyncRepo: '',
  setGitlabCustomSyncRepo: async (repo: string) => {
    set({ gitlabCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('gitlabCustomSyncRepo', repo)
    await store.save()
  },

  githubCustomImageRepo: '',
  setGithubCustomImageRepo: async (repo: string) => {
    set({ githubCustomImageRepo: repo })
    const store = await Store.load('store.json');
    await store.set('githubCustomImageRepo', repo)
    await store.save()
  },
}))

export default useSettingStore