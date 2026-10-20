import { uploadImageByGithub } from "./github";
import { uploadImageBySmms } from "./smms";
import { uploadImageByPicgo } from "./picgo";
import { uploadImageByS3 } from "./s3";
import { Store } from "@tauri-apps/plugin-store";
import { getNormalizedImageHosting } from "../image-hosting-config";
import {
  isCloudinaryConfigComplete,
  isCustomHttpImageConfigComplete,
  isImageKitConfigComplete,
  isLskyConfigComplete,
  isWebDavImageConfigComplete,
  uploadImageByCloudinary,
  uploadImageByCustomHttp,
  uploadImageByImageKit,
  uploadImageByLsky,
  uploadImageByWebDav,
} from './remote-services';
import {
  isQiniuConfigComplete,
  isUpyunConfigComplete,
  uploadImageByQiniu,
  uploadImageByUpyun,
} from './china-object-services';
import type {
  CloudinaryConfig,
  CustomHttpImageConfig,
  ImageKitConfig,
  LskyConfig,
  QiniuConfig,
  S3Config,
  UpyunConfig,
  WebDavImageConfig,
} from './types';
import type { SMMSImageHostingSetting } from './smms';
import type { PicgoImageHostingSetting } from './picgo';

async function hasCompleteImageHostingConfig(
  store: Store,
  provider: ReturnType<typeof getNormalizedImageHosting>['value'],
): Promise<boolean> {
  switch (provider) {
    case 'github':
      return Boolean(
        await store.get<string>('githubImageAccessToken')
        && await store.get<string>('githubImageUsername')
      )
    case 'smms':
      return Boolean((await store.get<SMMSImageHostingSetting>('smms'))?.token.trim())
    case 'picgo':
      return Boolean((await store.get<PicgoImageHostingSetting>('picgo'))?.url.trim())
    case 's3': {
      const config = await store.get<S3Config>('s3Config')
      return Boolean(
        config?.accessKeyId.trim()
        && config.secretAccessKey
        && config.region.trim()
        && config.bucket.trim()
      )
    }
    case 'lsky': {
      const config = await store.get<LskyConfig>('lskyImageConfig')
      return Boolean(config && isLskyConfigComplete(config))
    }
    case 'webdav': {
      const config = await store.get<WebDavImageConfig>('webdavImageConfig')
      return Boolean(config && isWebDavImageConfigComplete(config))
    }
    case 'custom-http': {
      const config = await store.get<CustomHttpImageConfig>('customHttpImageConfig')
      return Boolean(config && isCustomHttpImageConfigComplete(config))
    }
    case 'cloudinary': {
      const config = await store.get<CloudinaryConfig>('cloudinaryImageConfig')
      return Boolean(config && isCloudinaryConfigComplete(config))
    }
    case 'imagekit': {
      const config = await store.get<ImageKitConfig>('imageKitImageConfig')
      return Boolean(config && isImageKitConfigComplete(config))
    }
    case 'qiniu': {
      const config = await store.get<QiniuConfig>('qiniuImageConfig')
      return Boolean(config && isQiniuConfigComplete(config))
    }
    case 'upyun': {
      const config = await store.get<UpyunConfig>('upyunImageConfig')
      return Boolean(config && isUpyunConfigComplete(config))
    }
  }
}

export async function isImageHostingReady(): Promise<boolean> {
  const store = await Store.load('store.json')
  if (!await store.get<boolean>('useImageRepo')) return false

  const normalized = getNormalizedImageHosting(await store.get<string>('mainImageHosting'))
  if (normalized.shouldPersist) {
    await store.set('mainImageHosting', normalized.value)
    await store.save()
  }
  return await hasCompleteImageHostingConfig(store, normalized.value)
}

export async function uploadImage(file: File) {
  const store = await Store.load('store.json');

  // 检查是否启用了图床功能
  const useImageRepo = await store.get<boolean>('useImageRepo')
  const savedMainImageHosting = await store.get<string>('mainImageHosting')
  const normalizedImageHosting = getNormalizedImageHosting(savedMainImageHosting)
  const mainImageHosting = useImageRepo ? normalizedImageHosting.value : savedMainImageHosting

  if (!useImageRepo) {
    return undefined
  }

  // 如果没有配置图床，直接返回 undefined
  if (!mainImageHosting || mainImageHosting === 'none') {
    return undefined
  }

  if (normalizedImageHosting.shouldPersist) {
    await store.set('mainImageHosting', normalizedImageHosting.value)
    await store.save()
  }

  switch (mainImageHosting) {
    case 'github':
      return uploadImageByGithub(file)
    case 'smms':
      return uploadImageBySmms(file)
    case 'picgo':
      return uploadImageByPicgo(file)
    case 's3':
      return uploadImageByS3(file)
    case 'lsky':
      return uploadImageByLsky(file)
    case 'webdav':
      return uploadImageByWebDav(file)
    case 'custom-http':
      return uploadImageByCustomHttp(file)
    case 'cloudinary':
      return uploadImageByCloudinary(file)
    case 'imagekit':
      return uploadImageByImageKit(file)
    case 'qiniu':
      return uploadImageByQiniu(file)
    case 'upyun':
      return uploadImageByUpyun(file)
    default:
      return undefined
  }
}
