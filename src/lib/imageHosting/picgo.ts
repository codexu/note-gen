import { Store } from "@tauri-apps/plugin-store";
import { appDataDir } from '@tauri-apps/api/path'
import { mkdir, exists, writeFile, remove } from "@tauri-apps/plugin-fs";
import { v4 as uuid } from 'uuid';
import { toast } from "@/hooks/use-toast";

export interface PicgoImageHostingSetting {
  url: string
  port: string
}

export async function uploadImageByPicgo(image: File) {
  const store = await Store.load('store.json');
  const picgoSetting = await store.get<PicgoImageHostingSetting>('picgo')
  if (!picgoSetting) {
    return null
  }
  // 将 File 保存至缓存目录
  const cacheDir = await appDataDir()
  const cachePath = `${cacheDir}/picgo`
  if (!await exists(cachePath)) {
    await mkdir(cachePath)
  }
  const cacheFile = `${cachePath}/${uuid()}.png`
  const uint8Array = new Uint8Array(await image.arrayBuffer())
  await writeFile(cacheFile, uint8Array)
  const body = {
    list: [cacheFile]
  }
  try {
    const response = await fetch(`${picgoSetting.url}/upload`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    const data = await response.json()
    if (data.success) {
      return data.result[0]
    }
    return null
  } catch (error) {
    toast({
      title: 'Upload failed',
      description: error instanceof Error ? error.message : 'Upload failed',
      variant: 'destructive',
    })
    return null
  } finally {
    await remove(cacheFile)
  }
}

export async function checkPicgoState() {
  const store = await Store.load('store.json');
  const picgoSetting = await store.get<PicgoImageHostingSetting>('picgo')
  if (!picgoSetting) {
    return false
  }
  try {
    const response = await fetch(`${picgoSetting.url}/upload`, {
      method: 'POST',
    })
    await response.json()
    return true
  } catch {
    return false
  }
}
  