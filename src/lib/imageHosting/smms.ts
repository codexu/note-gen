import { Store } from "@tauri-apps/plugin-store";
import { fetch } from "@tauri-apps/plugin-http";

const BASE_URL = 'https://sm.ms/api/v2'

export interface SMMSImageHostingSetting {
  token: string
}

export interface SMMSUserInfo {
  disk_limit: string
  disk_limit_raw: number
  disk_usage: string
  disk_usage_raw: number
  email: string
  email_verified: number
  group_expire: string
  role: string
  username: number
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

// 获取用户基本信息
export async function getUserInfo() {
  const store = await Store.load('store.json');
  const config = await store.get<SMMSImageHostingSetting>('smms')
  if (!config) return
  const token = config.token

  const response = await fetch(`${BASE_URL}/profile`, {
    method: 'POST',
    headers: {
      'Authorization': token,
    }
  })
  const data = await response.json()
  return data.data as SMMSUserInfo
}
