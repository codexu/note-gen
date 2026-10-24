import { fetch } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import { v4 as uuid } from 'uuid'
import type { GiteaImageConfig } from './types'

function getRepositoryUrl(config: GiteaImageConfig) {
  const instance = new URL(config.baseUrl.trim())
  instance.search = ''
  instance.hash = ''
  const base = instance.toString().replace(/\/+$/, '').replace(/\/api\/v1$/, '')
  const repository = config.repository.trim().split('/').map(part => encodeURIComponent(part.trim())).join('/')
  return `${base}/api/v1/repos/${repository}`
}

export function isGiteaImageConfigComplete(config: GiteaImageConfig) {
  try {
    const url = new URL(config.baseUrl.trim())
    const repository = config.repository.trim().split('/')
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash
      && repository.length === 2 && repository.every(part => Boolean(part.trim()) && part !== '.' && part !== '..')
      && Boolean(config.token.trim())
      && !(config.pathPrefix || '').split('/').some(part => part === '..' || part === '.')
  } catch {
    return false
  }
}

async function requestOptions(config: GiteaImageConfig) {
  const store = await Store.load('store.json')
  const proxy = await store.get<string>('proxy')
  return {
    headers: {
      Authorization: `token ${config.token.trim()}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    proxy: proxy ? { all: proxy } : undefined,
  }
}

export async function testGiteaImageConnection(config: GiteaImageConfig) {
  if (!isGiteaImageConfigComplete(config)) return false
  const options = await requestOptions(config)
  const repositoryUrl = getRepositoryUrl(config)
  const response = await fetch(repositoryUrl, { ...options, method: 'GET' })
  if (!response.ok) return false
  const repository = await response.json() as { private?: boolean; archived?: boolean; permissions?: { push?: boolean } }
  if (repository.private || repository.archived || repository.permissions?.push !== true) return false
  if (!config.branch?.trim()) return true
  const branch = await fetch(`${repositoryUrl}/branches/${encodeURIComponent(config.branch.trim())}`, { ...options, method: 'GET' })
  return branch.ok
}

export async function uploadImageByGitea(file: File) {
  const store = await Store.load('store.json')
  const config = await store.get<GiteaImageConfig>('giteaImageConfig')
  if (!config || !isGiteaImageConfigComplete(config)) return undefined

  const extension = file.name.match(/\.[a-z\d]+$/i)?.[0] || ''
  const filename = `${uuid()}${extension}`
  const path = [...(config.pathPrefix || '').trim().split('/').filter(Boolean), filename].map(encodeURIComponent).join('/')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  }

  const response = await fetch(`${getRepositoryUrl(config)}/contents/${path}`, {
    ...await requestOptions(config),
    method: 'POST',
    body: JSON.stringify({
      message: `Upload ${filename}`,
      content: btoa(binary),
      ...(config.branch?.trim() ? { branch: config.branch.trim() } : {}),
    }),
  })
  if (!response.ok) throw new Error(`Gitea image upload failed (${response.status})`)
  const result = await response.json() as { content?: { download_url?: string } }
  const url = result.content?.download_url
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('Gitea did not return an image download URL')
  return url
}
