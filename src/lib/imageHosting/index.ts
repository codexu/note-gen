import { uploadImageByGithub } from "./github";
import { uploadImageBySmms } from "./smms";
import { uploadImageByPicgo } from "./picgo";
import { uploadImageByS3 } from "./s3";
import { Store } from "@tauri-apps/plugin-store";

export async function uploadImage(file: File) {
  const store = await Store.load('store.json');

  // 检查是否启用了图床功能
  const useImageRepo = await store.get<boolean>('useImageRepo')
  console.log('[ImageHosting] uploadImage - useImageRepo:', useImageRepo)

  if (!useImageRepo) {
    return undefined
  }

  const mainImageHosting = await store.get<string>('mainImageHosting')
  console.log('[ImageHosting] uploadImage - mainImageHosting:', mainImageHosting)

  // 如果没有配置图床，直接返回 undefined
  if (!mainImageHosting || mainImageHosting === 'none') {
    return undefined
  }

  switch (mainImageHosting) {
    case 'github':
      console.log('[ImageHosting] Uploading via GitHub...')
      return uploadImageByGithub(file)
    case 'smms':
      console.log('[ImageHosting] Uploading via SMMS...')
      return uploadImageBySmms(file)
    case 'picgo':
      console.log('[ImageHosting] Uploading via PicGo...')
      return uploadImageByPicgo(file)
    case 's3':
      console.log('[ImageHosting] Uploading via S3...')
      return uploadImageByS3(file)
    default:
      return undefined
  }
}