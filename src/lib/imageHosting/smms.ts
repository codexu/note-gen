import { Store } from "@tauri-apps/plugin-store";
import { fetch } from "@tauri-apps/plugin-http";

const BASE_URL = 'https://s.ee/api/v1/file'

export interface SMMSImageHostingSetting {
  token: string
}

export async function uploadImageBySmms(file: File) {
  const store = await Store.load('store.json');
  const config = await store.get<SMMSImageHostingSetting>('smms')
  if (!config) return
  const token = config.token

  const formData = new FormData()
  formData.append('smfile', file)
  formData.append('format', 'json')

  const response = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    body: formData,
    headers: {
      'Authorization': token,
      'Accept': 'application/json'
    }
  })

  const data = await response.json()
  if (data.code === 'image_repeated') {
    return data.images
  } else {
    return data.data.url
  }
}

// 使用 S.EE 文件域名接口校验 Token 是否可用
export async function getUserInfo() {
  const store = await Store.load('store.json');
  const config = await store.get<SMMSImageHostingSetting>('smms')
  if (!config) return
  const token = config.token

  const response = await fetch(`${BASE_URL}/domains`, {
    method: 'GET',
    headers: {
      'Authorization': token,
      'Accept': 'application/json'
    }
  })

  if (response.status < 200 || response.status >= 300) {
    return undefined
  }

  return response.json()
}
