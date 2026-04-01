import { uploadImageByGithub } from "./github";
import { uploadImageBySmms } from "./smms";
import { uploadImageByPicgo } from "./picgo";
import { uploadImageByS3 } from "./s3";
import { Store } from "@tauri-apps/plugin-store";
import { getNormalizedImageHosting } from "../image-hosting-config";

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
    default:
      return undefined
  }
}
