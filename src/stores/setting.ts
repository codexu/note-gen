import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { getVersion } from '@tauri-apps/api/app'
import { AiConfig } from '@/app/core/setting/config'
import { GitlabInstanceType } from '@/lib/sync/gitlab.types'
import { GiteaInstanceType } from '@/lib/sync/gitea.types'
import { noteGenDefaultModels, noteGenModelKeys } from '@/app/model-config'
import { fetch } from '@tauri-apps/plugin-http'

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

  sttModel: string
  setSttModel: (sttModel: string) => Promise<void>

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

  // Gitea 相关设置
  giteaInstanceType: GiteaInstanceType
  setGiteaInstanceType: (instanceType: GiteaInstanceType) => Promise<void>

  giteaCustomUrl: string
  setGiteaCustomUrl: (customUrl: string) => Promise<void>

  giteaAccessToken: string
  setGiteaAccessToken: (giteaAccessToken: string) => void

  giteaAutoSync: string
  setGiteaAutoSync: (giteaAutoSync: string) => Promise<void>

  giteaUsername: string
  setGiteaUsername: (giteaUsername: string) => Promise<void>

  // 主要备份方式设置
  primaryBackupMethod: 'github' | 'gitee' | 'gitlab' | 'gitea'
  setPrimaryBackupMethod: (method: 'github' | 'gitee' | 'gitlab' | 'gitea') => Promise<void>

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

  giteaCustomSyncRepo: string
  setGiteaCustomSyncRepo: (repo: string) => Promise<void>

  githubCustomImageRepo: string
  setGithubCustomImageRepo: (repo: string) => Promise<void>

  // 图片识别设置
  enableImageRecognition: boolean
  setEnableImageRecognition: (enable: boolean) => Promise<void>
  primaryImageMethod: 'ocr' | 'vlm'
  setPrimaryImageMethod: (method: 'ocr' | 'vlm') => Promise<void>

  // 界面缩放设置
  uiScale: number
  setUiScale: (scale: number) => Promise<void>

  // 正文文字大小缩放设置
  contentTextScale: number
  setContentTextScale: (scale: number) => Promise<void>

  // 自定义 CSS 设置
  customCss: string
  setCustomCss: (css: string) => Promise<void>

  // 聊天工具栏配置
  chatToolbarConfig: ChatToolbarItem[]
  setChatToolbarConfig: (config: ChatToolbarItem[]) => Promise<void>

  // 记录工具栏配置
  recordToolbarConfig: RecordToolbarItem[]
  setRecordToolbarConfig: (config: RecordToolbarItem[]) => Promise<void>
}

export interface ChatToolbarItem {
  id: string
  enabled: boolean
  order: number
}

export interface RecordToolbarItem {
  id: string
  enabled: boolean
  order: number
}


const useSettingStore = create<SettingState>((set, get) => ({
  initSettingData: async () => {
    const store = await Store.load('store.json');
    await get().setVersion()
    
    // 初始化默认的NoteGen模型配置
    const existingAiModelList = (await store.get('aiModelList') as AiConfig[]) || []
    const hasNoteGenModels = existingAiModelList.some(config => 
      config.key === 'note-gen-free' || 
      noteGenModelKeys.includes(config.key) ||
      config.models?.some(model => noteGenModelKeys.includes(model.id))
    )
    
    let finalAiModelList = existingAiModelList
    if (!hasNoteGenModels) {
      finalAiModelList = [...existingAiModelList, ...noteGenDefaultModels]
      await store.set('aiModelList', finalAiModelList)
      set({ aiModelList: finalAiModelList })
    }

    // 检查是否设置了主要模型，如果没有且存在note-gen-chat，则设置为主要模型
    const currentPrimaryModel = await store.get('primaryModel') as string
    const hasNoteGenChat = finalAiModelList.some(config => 
      config.models?.some(model => model.id === 'note-gen-chat') || config.key === 'note-gen-chat'
    )
    
    if (!currentPrimaryModel && hasNoteGenChat) {
      const noteGenFreeConfig = finalAiModelList.find(config => config.key === 'note-gen-free')
      if (noteGenFreeConfig?.models?.some(model => model.id === 'note-gen-chat')) {
        await store.set('primaryModel', 'note-gen-chat')
        set({ primaryModel: 'note-gen-chat' })
      } else {
        await store.set('primaryModel', 'note-gen-chat')
        set({ primaryModel: 'note-gen-chat' })
      }
    }

    // 检查是否设置了嵌入模型，如果没有且存在note-gen-embedding，则设置为默认嵌入模型
    const currentEmbeddingModel = await store.get('embeddingModel') as string
    const hasNoteGenEmbedding = finalAiModelList.some(config => 
      config.models?.some(model => model.id === 'note-gen-embedding') || config.key === 'note-gen-embedding'
    )
    
    if (!currentEmbeddingModel && hasNoteGenEmbedding) {
      const noteGenFreeConfig = finalAiModelList.find(config => config.key === 'note-gen-free')
      if (noteGenFreeConfig?.models?.some(model => model.id === 'note-gen-embedding')) {
        await store.set('embeddingModel', 'note-gen-embedding')
        set({ embeddingModel: 'note-gen-embedding' })
      } else {
        await store.set('embeddingModel', 'note-gen-embedding')
        set({ embeddingModel: 'note-gen-embedding' })
      }
    }

    // 检查是否设置了视觉语言模型，如果没有且存在note-gen-vlm，则设置为默认视觉语言模型
    const currentImageMethodModel = await store.get('imageMethodModel') as string
    const hasNoteGenVlm = finalAiModelList.some(config => 
      config.models?.some(model => model.id === 'note-gen-vlm') || config.key === 'note-gen-vlm'
    )
    
    if (!currentImageMethodModel && hasNoteGenVlm) {
      const noteGenFreeConfig = finalAiModelList.find(config => config.key === 'note-gen-free')
      if (noteGenFreeConfig?.models?.some(model => model.id === 'note-gen-vlm')) {
        await store.set('imageMethodModel', 'note-gen-vlm')
        set({ imageMethodModel: 'note-gen-vlm' })
      } else {
        await store.set('imageMethodModel', 'note-gen-vlm')
        set({ imageMethodModel: 'note-gen-vlm' })
      }
    }

    // 检查是否设置了TTS模型，如果没有且存在note-gen-tts，则设置为默认TTS模型
    const currentAudioModel = await store.get('audioModel') as string
    const hasNoteGenTTS = finalAiModelList.some(config => 
      config.models?.some(model => model.modelType === 'tts') || config.modelType === 'tts'
    )
    
    if (!currentAudioModel && hasNoteGenTTS) {
      // 查找第一个可用的TTS模型
      for (const config of finalAiModelList) {
        if (config.models && config.models.length > 0) {
          const ttsModel = config.models.find(model => model.modelType === 'tts')
          if (ttsModel) {
            await store.set('audioModel', `${config.key}-${ttsModel.id}`)
            set({ audioModel: `${config.key}-${ttsModel.id}` })
            break
          }
        } else if (config.modelType === 'tts') {
          await store.set('audioModel', config.key)
          set({ audioModel: config.key })
          break
        }
      }
    }

    // 检查是否设置了STT模型，如果没有且存在note-gen-stt，则设置为默认STT模型
    const currentSttModel = await store.get('sttModel') as string
    const hasNoteGenSTT = finalAiModelList.some(config => 
      config.models?.some(model => model.modelType === 'stt') || config.modelType === 'stt'
    )
    
    if (!currentSttModel && hasNoteGenSTT) {
      // 查找第一个可用的STT模型
      for (const config of finalAiModelList) {
        if (config.models && config.models.length > 0) {
          const sttModel = config.models.find(model => model.modelType === 'stt')
          if (sttModel) {
            await store.set('sttModel', `${config.key}-${sttModel.id}`)
            set({ sttModel: `${config.key}-${sttModel.id}` })
            break
          }
        } else if (config.modelType === 'stt') {
          await store.set('sttModel', config.key)
          set({ sttModel: config.key })
          break
        }
      }
    }

    // 检查并初始化其他模型类型
    const modelTypes = [
      { storeKey: 'placeholderModel', modelType: 'chat' },
      { storeKey: 'translateModel', modelType: 'chat' },
      { storeKey: 'markDescModel', modelType: 'chat' }
    ]

    for (const { storeKey, modelType } of modelTypes) {
      const currentModel = await store.get(storeKey) as string
      if (!currentModel) {
        // 查找第一个可用的聊天模型作为默认值
        const noteGenFreeConfig = finalAiModelList.find(config => config.key === 'note-gen-free')
        if (noteGenFreeConfig?.models?.some(model => model.id === 'note-gen-chat' && model.modelType === modelType)) {
          await store.set(storeKey, 'note-gen-chat')
          set({ [storeKey.replace('Model', '')]: 'note-gen-chat' })
        } else {
          // 查找其他可用的聊天模型
          for (const config of finalAiModelList) {
            if (config.models && config.models.length > 0) {
              const chatModel = config.models.find(model => model.modelType === modelType)
              if (chatModel) {
                await store.set(storeKey, `${config.key}-${chatModel.id}`)
                set({ [storeKey.replace('Model', '')]: `${config.key}-${chatModel.id}` })
                break
              }
            } else if (config.modelType === modelType || !config.modelType) {
              await store.set(storeKey, config.key)
              set({ [storeKey.replace('Model', '')]: config.key })
              break
            }
          }
        }
      }
    }

    // 获取 NoteGen 限时免费模型
    const apiKey = noteGenDefaultModels[0].apiKey
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
    const res = await fetch('https://api.notegen.top/v1/models', {
      method: 'GET',
      headers
    })

    const resModels = await res.json()

    if (resModels.data && resModels.data.length > 0) {
      // 移除旧的 NoteGen Limited 配置
      finalAiModelList = finalAiModelList.filter(model => 
        model.title !== 'NoteGen Limited' && model.key !== 'note-gen-limited'
      )
      
      // 过滤出不在默认模型中的限时免费模型
      const limitedModels = resModels.data.filter((model: any) => {
        // 检查是否在 noteGenDefaultModels 的 models 数组中
        return !noteGenDefaultModels[0].models?.some(defaultModel => defaultModel.model === model.id)
      })
      
      // 如果有限时免费模型，创建统一的 NoteGen Limited 配置
      if (limitedModels.length > 0) {
        const noteGenLimitedConfig = {
          apiKey,
          baseURL: "https://api.notegen.top/v1",
          key: "note-gen-limited",
          title: "NoteGen Limited",
          models: limitedModels.map((model: any) => ({
            id: `note-gen-limited-${model.id}`,
            model: model.id,
            modelType: "chat",
            temperature: 0.7,
            topP: 1,
            enableStream: true
          }))
        }
        
        finalAiModelList.push(noteGenLimitedConfig)
        await store.set('aiModelList', finalAiModelList)
        set({ aiModelList: finalAiModelList })
      }
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
    await store.set('audioModel', audioModel)
    set({ audioModel })
  },

  sttModel: '',
  setSttModel: async (sttModel) => {
    const store = await Store.load('store.json');
    await store.set('sttModel', sttModel)
    set({ sttModel })
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

  // Gitea 相关实现
  giteaInstanceType: GiteaInstanceType.OFFICIAL,
  setGiteaInstanceType: async (instanceType: GiteaInstanceType) => {
    const store = await Store.load('store.json')
    await store.set('giteaInstanceType', instanceType)
    await store.save()
    set({ giteaInstanceType: instanceType })
  },

  giteaCustomUrl: '',
  setGiteaCustomUrl: async (customUrl: string) => {
    const store = await Store.load('store.json')
    await store.set('giteaCustomUrl', customUrl)
    await store.save()
    set({ giteaCustomUrl: customUrl })
  },

  giteaAccessToken: '',
  setGiteaAccessToken: (giteaAccessToken: string) => {
    set({ giteaAccessToken })
  },

  giteaAutoSync: 'disabled',
  setGiteaAutoSync: async (giteaAutoSync: string) => {
    set({ giteaAutoSync })
    const store = await Store.load('store.json');
    await store.set('giteaAutoSync', giteaAutoSync)
    await store.save()
  },

  giteaUsername: '',
  setGiteaUsername: async (giteaUsername: string) => {
    const store = await Store.load('store.json')
    await store.set('giteaUsername', giteaUsername)
    await store.save()
    set({ giteaUsername })
  },

  giteaCustomSyncRepo: '',
  setGiteaCustomSyncRepo: async (repo: string) => {
    set({ giteaCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('giteaCustomSyncRepo', repo)
    await store.save()
  },

  // 默认使用 GitHub 作为主要备份方式
  primaryBackupMethod: 'github',
  setPrimaryBackupMethod: async (method: 'github' | 'gitee' | 'gitlab' | 'gitea') => {
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
  enableImageRecognition: true,
  setEnableImageRecognition: async (enable: boolean) => {
    set({ enableImageRecognition: enable })
    const store = await Store.load('store.json');
    await store.set('enableImageRecognition', enable)
    await store.save()
  },
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

  // 正文文字大小缩放设置 (75%, 100%, 125%, 150%)
  contentTextScale: 100,
  setContentTextScale: async (scale: number) => {
    set({ contentTextScale: scale })
    const store = await Store.load('store.json');
    await store.set('contentTextScale', scale)
    await store.save()
  },

  // 自定义 CSS 设置
  customCss: '',
  setCustomCss: async (css: string) => {
    set({ customCss: css })
    const store = await Store.load('store.json');
    await store.set('customCss', css)
    await store.save()
    
    // 应用自定义 CSS
    let styleElement = document.getElementById('custom-css-style')
    if (!styleElement) {
      styleElement = document.createElement('style')
      styleElement.id = 'custom-css-style'
      document.head.appendChild(styleElement)
    }
    styleElement.textContent = css
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

  // 聊天工具栏配置
  chatToolbarConfig: [
    { id: 'modelSelect', enabled: true, order: 0 },
    { id: 'promptSelect', enabled: true, order: 1 },
    { id: 'chatLanguage', enabled: true, order: 2 },
    { id: 'chatLink', enabled: true, order: 3 },
    { id: 'fileLink', enabled: true, order: 4 },
    { id: 'mcpButton', enabled: true, order: 5 },
    { id: 'ragSwitch', enabled: true, order: 6 },
    { id: 'chatPlaceholder', enabled: true, order: 7 },
    { id: 'clipboardMonitor', enabled: true, order: 8 },
    { id: 'clearContext', enabled: true, order: 9 },
    { id: 'clearChat', enabled: true, order: 10 },
  ],
  setChatToolbarConfig: async (config: ChatToolbarItem[]) => {
    set({ chatToolbarConfig: config })
    const store = await Store.load('store.json');
    await store.set('chatToolbarConfig', config)
    await store.save()
  },

  // 记录工具栏配置
  recordToolbarConfig: [
    { id: 'text', enabled: true, order: 0 },
    { id: 'recording', enabled: true, order: 1 },
    { id: 'scan', enabled: true, order: 2 },
    { id: 'image', enabled: true, order: 3 },
    { id: 'link', enabled: true, order: 4 },
    { id: 'file', enabled: true, order: 5 },
  ],
  setRecordToolbarConfig: async (config: RecordToolbarItem[]) => {
    set({ recordToolbarConfig: config })
    const store = await Store.load('store.json');
    await store.set('recordToolbarConfig', config)
    await store.save()
  },
}))

export default useSettingStore