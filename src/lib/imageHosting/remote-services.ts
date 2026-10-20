import { fetch, type Proxy } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import { v4 as uuid } from 'uuid'

import type {
  CloudinaryConfig,
  CustomHttpImageConfig,
  ImageKitConfig,
  LskyConfig,
  WebDavImageConfig,
} from './types'

async function getProxy(): Promise<Proxy | undefined> {
  const store = await Store.load('store.json')
  const proxyUrl = await store.get<string>('proxy')
  return proxyUrl ? { all: proxyUrl } : undefined
}

function trimSlashes(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function joinUrl(baseUrl: string, ...parts: string[]) {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const suffix = parts.map(trimSlashes).filter(Boolean).join('/')
  return suffix ? `${base}/${suffix}` : base
}

function createFileName(file: File) {
  const extension = file.name.includes('.') ? file.name.split('.').pop() : undefined
  return `${uuid()}${extension ? `.${extension}` : ''}`
}

function basicAuth(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`
}

async function parseJsonResponse(response: Response) {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(text || `${response.status} ${response.statusText}`)
  }
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('The service returned an invalid JSON response')
  }
}

function readJsonPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object') return undefined
      return (current as Record<string, unknown>)[part]
    }, value)
}

function parseHeaders(value: string) {
  if (!value.trim()) return new Headers()
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object')
  }

  const headers = new Headers()
  for (const [key, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== 'string') {
      throw new Error(`Header "${key}" must be a string`)
    }
    headers.set(key, headerValue)
  }
  return headers
}

function parseFormFields(value: string) {
  if (!value.trim()) return {}
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Form fields must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

export function isLskyConfigComplete(config: LskyConfig) {
  return Boolean(config.apiUrl.trim() && config.token.trim())
}

export async function testLskyConnection(config: LskyConfig) {
  if (!isLskyConfigComplete(config)) return false
  const response = await fetch(joinUrl(config.apiUrl, 'profile'), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.token.trim()}`,
      Accept: 'application/json',
    },
    proxy: await getProxy(),
  })
  return response.ok
}

export async function uploadImageByLsky(file: File) {
  const store = await Store.load('store.json')
  const config = await store.get<LskyConfig>('lskyImageConfig')
  if (!config || !isLskyConfigComplete(config)) return undefined

  const formData = new FormData()
  formData.append('file', file, file.name)
  if (config.strategyId?.trim()) {
    formData.append('strategy_id', config.strategyId.trim())
  }

  const response = await fetch(joinUrl(config.apiUrl, 'upload'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token.trim()}`,
      Accept: 'application/json',
    },
    body: formData,
    proxy: await getProxy(),
  })
  const result = await parseJsonResponse(response)
  const url = readJsonPath(result, 'data.links.url')
    ?? readJsonPath(result, 'data.url')
    ?? readJsonPath(result, 'url')
  if (typeof url !== 'string' || !url) {
    throw new Error('Lsky did not return an image URL')
  }
  return url
}

export function isWebDavImageConfigComplete(config: WebDavImageConfig) {
  return Boolean(
    config.baseUrl.trim()
    && config.username.trim()
    && config.password
    && config.publicUrl.trim(),
  )
}

export async function testWebDavImageConnection(config: WebDavImageConfig) {
  if (!isWebDavImageConfigComplete(config)) return false
  const response = await fetch(config.baseUrl.trim(), {
    method: 'PROPFIND',
    headers: {
      Authorization: basicAuth(config.username.trim(), config.password),
      Depth: '0',
    },
    proxy: await getProxy(),
  })
  return response.ok || response.status === 207
}

export async function uploadImageByWebDav(file: File) {
  const store = await Store.load('store.json')
  const config = await store.get<WebDavImageConfig>('webdavImageConfig')
  if (!config || !isWebDavImageConfigComplete(config)) return undefined

  const fileName = createFileName(file)
  const relativePath = [trimSlashes(config.pathPrefix || ''), fileName]
    .filter(Boolean)
    .join('/')
  const auth = basicAuth(config.username.trim(), config.password)
  const proxy = await getProxy()
  const prefixParts = trimSlashes(config.pathPrefix || '').split('/').filter(Boolean)
  let currentCollection = config.baseUrl
  for (const part of prefixParts) {
    currentCollection = joinUrl(currentCollection, part)
    const createResponse = await fetch(currentCollection, {
      method: 'MKCOL',
      headers: { Authorization: auth },
      proxy,
    })
    if (
      !createResponse.ok
      && createResponse.status !== 405
      && createResponse.status !== 301
      && createResponse.status !== 302
    ) {
      throw new Error(
        (await createResponse.text())
        || `Failed to create WebDAV folder: ${createResponse.status}`,
      )
    }
  }
  const response = await fetch(joinUrl(config.baseUrl, relativePath), {
    method: 'PUT',
    headers: {
      Authorization: auth,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: new Uint8Array(await file.arrayBuffer()),
    proxy,
  })
  if (!response.ok) {
    throw new Error((await response.text()) || `${response.status} ${response.statusText}`)
  }
  return joinUrl(config.publicUrl, relativePath)
}

export function isCustomHttpImageConfigComplete(config: CustomHttpImageConfig) {
  if (!config.url.trim() || !config.responseUrlPath.trim()) return false
  try {
    parseHeaders(config.headers)
    new URL(config.url)
    return true
  } catch {
    return false
  }
}

export async function uploadImageByCustomHttp(file: File) {
  const store = await Store.load('store.json')
  const config = await store.get<CustomHttpImageConfig>('customHttpImageConfig')
  if (!config || !isCustomHttpImageConfigComplete(config)) return undefined

  const fileName = createFileName(file)
  const url = config.url
    .replaceAll('{filename}', encodeURIComponent(fileName))
    .replaceAll('{originalName}', encodeURIComponent(file.name))
  const headers = parseHeaders(config.headers)
  let body: FormData | Uint8Array

  if (config.method === 'PUT') {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', file.type || 'application/octet-stream')
    }
    body = new Uint8Array(await file.arrayBuffer())
  } else {
    const formData = new FormData()
    for (const [key, value] of Object.entries(parseFormFields(config.formFields))) {
      formData.append(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
    formData.append(config.fileField.trim() || 'file', file, fileName)
    body = formData
  }

  const response = await fetch(url, {
    method: config.method,
    headers,
    body,
    proxy: await getProxy(),
  })
  if (!response.ok) {
    throw new Error((await response.text()) || `${response.status} ${response.statusText}`)
  }
  if (config.responseUrlPath === '$requestUrl') return url
  if (config.responseUrlPath.startsWith('header.')) {
    const headerName = config.responseUrlPath.slice('header.'.length)
    const headerUrl = response.headers.get(headerName)
    if (!headerUrl) throw new Error(`Response header "${headerName}" was not found`)
    return headerUrl
  }

  const result = await parseJsonResponse(response)
  const imageUrl = readJsonPath(result, config.responseUrlPath)
  if (typeof imageUrl !== 'string' || !imageUrl) {
    throw new Error(`Response path "${config.responseUrlPath}" did not contain a URL`)
  }
  return imageUrl
}

export function isCloudinaryConfigComplete(config: CloudinaryConfig) {
  return Boolean(config.cloudName.trim() && config.uploadPreset.trim())
}

export async function uploadImageByCloudinary(file: File) {
  const store = await Store.load('store.json')
  const config = await store.get<CloudinaryConfig>('cloudinaryImageConfig')
  if (!config || !isCloudinaryConfigComplete(config)) return undefined

  const formData = new FormData()
  formData.append('file', file, file.name)
  formData.append('upload_preset', config.uploadPreset.trim())
  if (config.folder?.trim()) formData.append('folder', config.folder.trim())

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName.trim())}/image/upload`,
    {
      method: 'POST',
      body: formData,
      proxy: await getProxy(),
    },
  )
  const result = await parseJsonResponse(response)
  const imageUrl = readJsonPath(result, 'secure_url')
  if (typeof imageUrl !== 'string' || !imageUrl) {
    throw new Error('Cloudinary did not return a secure URL')
  }
  return imageUrl
}

export function isImageKitConfigComplete(config: ImageKitConfig) {
  return Boolean(config.privateKey.trim())
}

export async function testImageKitConnection(config: ImageKitConfig) {
  if (!isImageKitConfigComplete(config)) return false
  const response = await fetch('https://api.imagekit.io/v1/files?limit=1', {
    method: 'GET',
    headers: {
      Authorization: basicAuth(config.privateKey.trim(), ''),
    },
    proxy: await getProxy(),
  })
  return response.ok
}

export async function uploadImageByImageKit(file: File) {
  const store = await Store.load('store.json')
  const config = await store.get<ImageKitConfig>('imageKitImageConfig')
  if (!config || !isImageKitConfigComplete(config)) return undefined

  const formData = new FormData()
  formData.append('file', file, file.name)
  formData.append('fileName', createFileName(file))
  if (config.folder?.trim()) formData.append('folder', config.folder.trim())

  const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: {
      Authorization: basicAuth(config.privateKey.trim(), ''),
    },
    body: formData,
    proxy: await getProxy(),
  })
  const result = await parseJsonResponse(response)
  const imageUrl = readJsonPath(result, 'url')
  if (typeof imageUrl !== 'string' || !imageUrl) {
    throw new Error('ImageKit did not return an image URL')
  }
  return imageUrl
}
