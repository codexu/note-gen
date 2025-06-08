import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'

// Check if we're in Tauri environment
const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__;

export enum GenTemplateRange {
  All = '全部',
  Today = '今天',
  Week = '近一周',
  Month = '近一月',
  ThreeMonth = '近三个月',
  Year = '近一年',
}

export interface GenTemplate {
  id: string
  title: string
  status: boolean
  content: string
  range: GenTemplateRange
}

interface SettingState {
  // GitHub settings
  accessToken: string;
  githubUsername: string;
  
  // Gitee settings
  giteeAccessToken: string;
  giteeUsername: string;
  
  // Primary backup method
  primaryBackupMethod: 'github' | 'gitee';
  
  // Proxy settings
  proxy: string;
  
  // Initialization functions
  initialize: () => Promise<void>;
  
  // Setting functions
  setAccessToken: (token: string) => Promise<void>;
  setGithubUsername: (username: string) => Promise<void>;
  setGiteeAccessToken: (token: string) => Promise<void>; 
  setGiteeUsername: (username: string) => Promise<void>;
  setPrimaryBackupMethod: (method: 'github' | 'gitee') => Promise<void>;
  setProxy: (proxy: string) => Promise<void>;

  initSettingData: () => Promise<void>

  version: string
  setVersion:  () => Promise<void>

  autoUpdate: boolean
  setAutoUpdate: (autoUpdate: boolean) => void

  language: string
  setLanguage: (language: string) => void

  aiType: string
  setAiType: (aiType: string) => void

  baseURL: string
  setBaseURL: (baseURL: string) => void

  apiKey: string
  setApiKey: (apiKey: string) => void

  model: string
  setModel: (language: string) => void

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

  jsdelivr: boolean
  setJsdelivr: (jsdelivr: boolean) => void

  useImageRepo: boolean
  setUseImageRepo: (useImageRepo: boolean) => Promise<void>

  autoSync: string
  setAutoSync: (autoSync: string) => Promise<void>
  
  lastSettingPage: string
  setLastSettingPage: (page: string) => Promise<void>

  workspacePath: string
  setWorkspacePath: (path: string) => Promise<void>
}


const useSettingStore = create<SettingState>((set, get) => ({
  accessToken: '',
  githubUsername: '',
  giteeAccessToken: '',
  giteeUsername: '',
  primaryBackupMethod: 'github',
  proxy: '',

  // Initialize store
  initialize: async () => {
    if (!isTauri) {
      console.log('Settings not available in browser mode');
      return;
    }

    try {
      const store = await Store.load('store.json');
      
      const accessToken = await store.get<string>('accessToken') || '';
      const githubUsername = await store.get<string>('githubUsername') || '';
      const giteeAccessToken = await store.get<string>('giteeAccessToken') || '';
      const giteeUsername = await store.get<string>('giteeUsername') || '';
      const primaryBackupMethod = await store.get<'github' | 'gitee'>('primaryBackupMethod') || 'github';
      const proxy = await store.get<string>('proxy') || '';
      
      set({ 
        accessToken, 
        githubUsername,
        giteeAccessToken,
        giteeUsername,
        primaryBackupMethod,
        proxy
      });
    } catch (error) {
      console.error('Failed to initialize settings:', error);
    }
  },

  // Set GitHub access token
  setAccessToken: async (token: string) => {
    if (!isTauri) {
      console.log('Settings not available in browser mode');
      return;
    }

    try {
      const store = await Store.load('store.json');
      await store.set('accessToken', token);
      set({ accessToken: token });
    } catch (error) {
      console.error('Failed to save access token:', error);
    }
  },

  // Set GitHub username
  setGithubUsername: async (username: string) => {
    if (!isTauri) {
      console.log('Settings not available in browser mode');
      return;
    }

    try {
      const store = await Store.load('store.json');
      await store.set('githubUsername', username);
      set({ githubUsername: username });
    } catch (error) {
      console.error('Failed to save GitHub username:', error);
    }
  },

  // Set Gitee access token
  setGiteeAccessToken: async (token: string) => {
    if (!isTauri) {
      console.log('Settings not available in browser mode');
      return;
    }

    try {
      const store = await Store.load('store.json');
      await store.set('giteeAccessToken', token);
      set({ giteeAccessToken: token });
    } catch (error) {
      console.error('Failed to save Gitee access token:', error);
    }
  },

  // Set Gitee username
  setGiteeUsername: async (username: string) => {
    if (!isTauri) {
      console.log('Settings not available in browser mode');
      return;
    }

    try {
      const store = await Store.load('store.json');
      await store.set('giteeUsername', username);
      set({ giteeUsername: username });
    } catch (error) {
      console.error('Failed to save Gitee username:', error);
    }
  },

  // Set primary backup method
  setPrimaryBackupMethod: async (method: 'github' | 'gitee') => {
    if (!isTauri) {
      console.log('Settings not available in browser mode');
      return;
    }

    try {
      const store = await Store.load('store.json');
      await store.set('primaryBackupMethod', method);
      set({ primaryBackupMethod: method });
    } catch (error) {
      console.error('Failed to save primary backup method:', error);
    }
  },

  // Set proxy
  setProxy: async (proxy: string) => {
    if (!isTauri) {
      console.log('Settings not available in browser mode');
      return;
    }

    try {
      const store = await Store.load('store.json');
      await store.set('proxy', proxy);
      set({ proxy });
    } catch (error) {
      console.error('Failed to save proxy settings:', error);
    }
  },

  initSettingData: async () => {
    if (!isTauri) {
      console.log('Settings data not available in browser mode');
      return;
    }

    try {
      const store = await Store.load('store.json');
      await get().setVersion()
      Object.entries(get()).forEach(async([key, value]) => {
        const res = await store.get(key)
        if (typeof value === 'function') return
        if (res !== undefined && key!== 'version') {
          if (key === 'templateList') {
            set({ [key]: [] })
            setTimeout(() => {
              set({ [key]: res as GenTemplate[] })
            }, 0);
          } else {
            set({ [key]: res })
          }
        } else {
          await store.set(key, value)
        }
      })
    } catch (error) {
      console.log('Failed to initialize settings data:', error);
    }
  },

  version: '',
  setVersion: async() => {
    if (!isTauri) {
      set({ version: 'browser-mode' });
      return;
    }

    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      const version = await getVersion();
      set({ version });
    } catch (error) {
      console.log('Failed to get version:', error);
      set({ version: 'unknown' });
    }
  },

  autoUpdate: true,
  setAutoUpdate: (autoUpdate) => set({ autoUpdate }),

  language: '简体中文',
  setLanguage: (language) => set({ language }),

  aiType: 'chatgpt',
  setAiType: (aiType) => set({ aiType }),

  baseURL: '',
  setBaseURL: (baseURL) => set({ baseURL }),

  apiKey: '',
  setApiKey: (apiKey) => set({ apiKey }),

  model: '',
  setModel: (model) => set({ model }),

  placeholderModel: '',
  setPlaceholderModel: async (placeholderModel) => {
    set({ placeholderModel })
    
    if (!isTauri) {
      console.log('Model settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('placeholderModel', placeholderModel)
    } catch (error) {
      console.error('Failed to save placeholder model:', error);
    }
  },

  translateModel: '',
  setTranslateModel: async (translateModel) => {
    set({ translateModel })
    
    if (!isTauri) {
      console.log('Model settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('translateModel', translateModel)
    } catch (error) {
      console.error('Failed to save translate model:', error);
    }
  },

  markDescModel: '',
  setMarkDescModel: async (markDescModel) => {
    set({ markDescModel })
    
    if (!isTauri) {
      console.log('Model settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('markDescModel', markDescModel)
    } catch (error) {
      console.error('Failed to save mark description model:', error);
    }
  },

  embeddingModel: '',
  setEmbeddingModel: async (embeddingModel) => {
    set({ embeddingModel })
    
    if (!isTauri) {
      console.log('Model settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('embeddingModel', embeddingModel)
    } catch (error) {
      console.error('Failed to save embedding model:', error);
    }
  },

  rerankingModel: '',
  setRerankingModel: async (rerankingModel) => {
    set({ rerankingModel })
    
    if (!isTauri) {
      console.log('Model settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('rerankingModel', rerankingModel)
    } catch (error) {
      console.error('Failed to save reranking model:', error);
    }
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
    
    if (!isTauri) {
      console.log('Template settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json')
      await store.set('templateList', templateList)
    } catch (error) {
      console.error('Failed to save template list:', error);
    }
  },

  darkMode: 'system',
  setDarkMode: (darkMode) => set({ darkMode }),

  previewTheme: 'github',
  setPreviewTheme: (previewTheme) => set({ previewTheme }),

  codeTheme: 'github',
  setCodeTheme: (codeTheme) => set({ codeTheme }),

  tesseractList: 'eng,chi_sim',
  setTesseractList: (tesseractList) => set({ tesseractList }),

  jsdelivr: true,
  setJsdelivr: async (jsdelivr: boolean) => {
    set({ jsdelivr })
    
    if (!isTauri) {
      console.log('JSDelivr settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('jsdelivr', jsdelivr)
    } catch (error) {
      console.error('Failed to save jsdelivr setting:', error);
    }
  },

  useImageRepo: true,
  setUseImageRepo: async (useImageRepo: boolean) => {
    set({ useImageRepo })
    
    if (!isTauri) {
      console.log('Image repository settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('useImageRepo', useImageRepo)
    } catch (error) {
      console.error('Failed to save image repository setting:', error);
    }
  },

  autoSync: 'disabled',
  setAutoSync: async (autoSync: string) => {
    set({ autoSync })
    
    if (!isTauri) {
      console.log('Auto sync settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('autoSync', autoSync)
    } catch (error) {
      console.error('Failed to save auto sync setting:', error);
    }
  },
  
  lastSettingPage: 'ai',
  setLastSettingPage: async (page: string) => {
    set({ lastSettingPage: page })
    
    if (!isTauri) {
      console.log('Settings persistence not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('lastSettingPage', page)
    } catch (error) {
      console.error('Failed to save last setting page:', error);
    }
  },

  workspacePath: '',
  setWorkspacePath: async (path: string) => {
    set({ workspacePath: path })
    
    if (!isTauri) {
      console.log('Workspace settings not available in browser mode');
      return;
    }
    
    try {
      const store = await Store.load('store.json');
      await store.set('workspacePath', path)
    } catch (error) {
      console.error('Failed to save workspace path:', error);
    }
  },
}))

export default useSettingStore