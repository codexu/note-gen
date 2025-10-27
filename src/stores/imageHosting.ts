import { GithubFile } from '@/lib/sync/github';
import { getImageFiles } from '@/lib/imageHosting/github';
import { GithubRepoInfo, OctokitResponse, SyncStateEnum, UserInfo } from '@/lib/sync/github.types';
import { Store } from '@tauri-apps/plugin-store';
import { create } from 'zustand'

interface S3Config {
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
  endpoint?: string
  customDomain?: string
  pathPrefix?: string
}

interface MarkState {
  initMainHosting: () => Promise<void>
  path: string
  setPath: (path: string) => void

  images: GithubFile[]
  pushImage: (image: GithubFile) => void
  deleteImage: (name: string) => void
  getImages: () => Promise<void>

  // 主要图床
  mainImageHosting: string
  setMainImageHosting: (mainImageHosting: string) => Promise<void>
  
  // 图床 Github 仓库
  imageRepoUserInfo?: OctokitResponse<UserInfo>
  setImageRepoUserInfo: (imageRepoUserInfo?: OctokitResponse<UserInfo>) => Promise<void>
  imageRepoState: SyncStateEnum
  setImageRepoState: (imageRepoState: SyncStateEnum) => void
  imageRepoInfo?: GithubRepoInfo
  setImageRepoInfo: (imageRepoInfo?: GithubRepoInfo) => void

  // S3 配置
  s3Config?: S3Config
  setS3Config: (config: S3Config) => Promise<void>
  s3State: SyncStateEnum
  setS3State: (state: SyncStateEnum) => void
}

const useImageStore = create<MarkState>((set, get) => ({
  initMainHosting: async () => {
    const store = await Store.load('store.json');
    const mainImageHosting = await store.get<string>('mainImageHosting')
    if (mainImageHosting) {
      set({ mainImageHosting })
    }
    
    // 初始化 S3 配置
    const s3Config = await store.get<S3Config>('s3Config');
    if (s3Config) {
      set({ s3Config })
    }
  },
  path: '',
  setPath: (path) => set({ path }),

  images: [],

  pushImage: (image) => {
    set(state => ({
      images: [image, ...state.images]
    }))
  },
  deleteImage: (name) => {
    set(state => ({
      images: state.images.filter(item => item.name !== name)
    }))
  },
  async getImages() {
    set({ images: [] })
    const images = await getImageFiles({ path: get().path })
    set({ images: images || [] })
  },

  // 主要图床
  mainImageHosting: 'github',
  setMainImageHosting: async (mainImageHosting) => {
    set({ mainImageHosting })
    const store = await Store.load('store.json');
    await store.set('mainImageHosting', mainImageHosting)
    await store.save()
  },

  imageRepoUserInfo: undefined,
  setImageRepoUserInfo: async (imageRepoUserInfo) => {
    set({ imageRepoUserInfo })
    if (!imageRepoUserInfo) return
    const store = await Store.load('store.json');
    await store.set('githubImageUsername', imageRepoUserInfo?.data?.login)
    await store.save()
  },
  imageRepoState: SyncStateEnum.fail,
  setImageRepoState: (imageRepoState) => {
    set({ imageRepoState })
  },
  imageRepoInfo: undefined,
  setImageRepoInfo: (imageRepoInfo) => {
    set({ imageRepoInfo })
  },

  // S3 配置
  s3Config: undefined,
  setS3Config: async (config) => {
    set({ s3Config: config })
    const store = await Store.load('store.json');
    await store.set('s3Config', config)
    await store.save()
  },
  s3State: SyncStateEnum.fail,
  setS3State: (s3State) => {
    set({ s3State })
  },
}))

export default useImageStore