import CryptoJS from 'crypto-js'
import { fetch, type Proxy } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import { v4 as uuid } from 'uuid'

import type { QiniuConfig, UpyunConfig } from './types'

async function getProxy(): Promise<Proxy | undefined> {
  const store = await Store.load('store.json')
  const proxyUrl = await store.get<string>('proxy')
  return proxyUrl ? { all: proxyUrl } : undefined
}

function trimSlashes(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${trimSlashes(path)}`
}

function createObjectKey(file: File, prefix?: string) {
  const extension = file.name.includes('.') ? file.name.split('.').pop() : undefined
  const fileName = `${uuid()}${extension ? `.${extension}` : ''}`
  return [trimSlashes(prefix || ''), fileName].filter(Boolean).join('/')
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function toUrlSafeBase64(bytes: Uint8Array) {
  return bytesToBase64(bytes)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

async function hmacSha1(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)),
  )
}

export function isQiniuConfigComplete(config: QiniuConfig) {
  return Boolean(
    config.accessKey.trim()
    && config.secretKey.trim()
    && config.bucket.trim()
    && config.publicUrl.trim()
    && config.uploadUrl.trim(),
  )
}

async function createQiniuUploadToken(config: QiniuConfig, key: string) {
  const policy = {
    scope: `${config.bucket.trim()}:${key}`,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  }
  const encodedPolicy = toUrlSafeBase64(
    new TextEncoder().encode(JSON.stringify(policy)),
  )
  const signature = toUrlSafeBase64(
    await hmacSha1(config.secretKey.trim(), encodedPolicy),
  )
  return `${config.accessKey.trim()}:${signature}:${encodedPolicy}`
}

export async function uploadImageByQiniu(file: File) {
  const store = await Store.load('store.json')
  const config = await store.get<QiniuConfig>('qiniuImageConfig')
  if (!config || !isQiniuConfigComplete(config)) return undefined

  const key = createObjectKey(file, config.pathPrefix)
  const formData = new FormData()
  formData.append('token', await createQiniuUploadToken(config, key))
  formData.append('key', key)
  formData.append('file', file, file.name)

  const response = await fetch(config.uploadUrl.trim(), {
    method: 'POST',
    body: formData,
    proxy: await getProxy(),
  })
  if (!response.ok) {
    throw new Error((await response.text()) || `${response.status} ${response.statusText}`)
  }
  return joinUrl(config.publicUrl, key)
}

export function isUpyunConfigComplete(config: UpyunConfig) {
  return Boolean(
    config.bucket.trim()
    && config.operator.trim()
    && config.password
    && config.publicUrl.trim(),
  )
}

async function createUpyunAuthorization({
  config,
  method,
  uri,
  date,
}: {
  config: UpyunConfig
  method: string
  uri: string
  date: string
}) {
  const passwordMd5 = CryptoJS.MD5(config.password).toString()
  const signature = bytesToBase64(
    await hmacSha1(passwordMd5, `${method}&${uri}&${date}`),
  )
  return `UPYUN ${config.operator.trim()}:${signature}`
}

export async function testUpyunConnection(config: UpyunConfig) {
  if (!isUpyunConfigComplete(config)) return false
  const method = 'GET'
  const uri = `/${encodeURIComponent(config.bucket.trim())}/`
  const date = new Date().toUTCString()
  const response = await fetch(`https://v0.api.upyun.com${uri}`, {
    method,
    headers: {
      Authorization: await createUpyunAuthorization({
        config,
        method,
        uri,
        date,
      }),
      Date: date,
      Accept: 'application/json',
    },
    proxy: await getProxy(),
  })
  return response.ok
}

export async function uploadImageByUpyun(file: File) {
  const store = await Store.load('store.json')
  const config = await store.get<UpyunConfig>('upyunImageConfig')
  if (!config || !isUpyunConfigComplete(config)) return undefined

  const key = createObjectKey(file, config.pathPrefix)
  const uri = `/${encodeURIComponent(config.bucket.trim())}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  const date = new Date().toUTCString()
  const method = 'PUT'
  const body = new Uint8Array(await file.arrayBuffer())
  const response = await fetch(`https://v0.api.upyun.com${uri}`, {
    method,
    headers: {
      Authorization: await createUpyunAuthorization({
        config,
        method,
        uri,
        date,
      }),
      Date: date,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body,
    proxy: await getProxy(),
  })
  if (!response.ok) {
    throw new Error((await response.text()) || `${response.status} ${response.statusText}`)
  }
  return joinUrl(config.publicUrl, key)
}
