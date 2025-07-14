import { Store } from "@tauri-apps/plugin-store";
import { SMMSImageHostingSetting } from "./imageHosting.d";
import { fetch } from "@tauri-apps/plugin-http";

const BASE_URL = 'https://sm.ms/api/v2'

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
