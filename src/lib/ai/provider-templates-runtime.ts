import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { Store } from '@tauri-apps/plugin-store'
import MD5 from 'crypto-js/md5.js'

import type { AiConfig } from '@/app/core/setting/config'

const UPGRADE_LINK_CONFIGURATION_KEY = 'sLwoVGPpyngsYyubAk2V8g'
const UPGRADE_LINK_ACCESS_KEY = 'wHi8Tkuc5i6v1UCAuVk48A'
const UPGRADE_LINK_SECRET_KEY = 'eg4upYo7ruJgaDVOtlHJGj4lyzG4Oh9IpLGwOc6Oehw'
const UPGRADE_LINK_UPGRADE_URL = 'https://api.upgrade.toolsetlink.com/v1/configuration/upgrade'
const UPGRADE_LINK_UPGRADE_URI = '/v1/configuration/upgrade'
const INITIAL_PROVIDER_TEMPLATE_VERSION_CODE = 1

export const PROVIDER_TEMPLATE_CACHE_KEY = 'providerTemplatesCache'

export interface ProviderTemplateCache {
  versionCode?: number
  versionName?: string
  fetchedAt: string
  content: {
    providers: unknown[]
  }
}

function mapBuiltinTemplates(templates: AiConfig[]): AiConfig[] {
  return templates.map((template) => ({
    ...template,
    templateKey: template.templateKey || template.key,
    templateSource: 'builtin' as const,
  }))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false
  }

  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function parseContentPayload(payload: unknown) {
  if (!payload) {
    return null
  }

  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload)
    } catch {
      return null
    }
  }

  if (typeof payload === 'object') {
    return payload
  }

  return null
}

function buildUpgradeLinkSignature({
  body,
  nonce,
  secretKey,
  timestamp,
  uri,
}: {
  body?: string
  nonce: string
  secretKey: string
  timestamp: string
  uri: string
}) {
  const source = body
    ? `body=${body}&nonce=${nonce}&secretKey=${secretKey}&timestamp=${timestamp}&url=${uri}`
    : `nonce=${nonce}&secretKey=${secretKey}&timestamp=${timestamp}&url=${uri}`

  return MD5(source).toString()
}

function normalizeProviderTemplatesPayload(payload: unknown): AiConfig[] {
  const parsedPayload = parseContentPayload(payload)
  const providers = Array.isArray((parsedPayload as { providers?: unknown[] } | null)?.providers)
    ? (parsedPayload as { providers: unknown[] }).providers
    : []

  return providers
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter((item) => item.enabled !== false)
    .filter((item) => isNonEmptyString(item.key))
    .filter((item) => isNonEmptyString(item.title))
    .filter((item) => isValidUrl(item.baseURL))
    .map((item) => ({
      key: String(item.key).trim(),
      title: String(item.title).trim(),
      baseURL: String(item.baseURL).trim(),
      icon: isNonEmptyString(item.icon) ? item.icon.trim() : undefined,
      apiKeyUrl: isValidUrl(item.apiKeyUrl) ? item.apiKeyUrl.trim() : undefined,
      enabled: true,
      templateSource: (item.templateSource as AiConfig['templateSource']) || 'remote',
    }))
}

function matchProviderTemplate({
  currentConfig,
  templates,
}: {
  currentConfig: AiConfig | undefined
  templates: AiConfig[]
}) {
  if (!currentConfig || templates.length === 0) {
    return null
  }

  if (isNonEmptyString(currentConfig.templateKey)) {
    const matchedByKey = templates.find((item) => item.key === currentConfig.templateKey)
    if (matchedByKey) {
      return matchedByKey
    }
  }

  if (isValidUrl(currentConfig.baseURL)) {
    const matchedByBaseUrl = templates.find((item) => item.baseURL === currentConfig.baseURL)
    if (matchedByBaseUrl) {
      return matchedByBaseUrl
    }
  }

  return null
}

function mapRemoteTemplates(content: ProviderTemplateCache['content'] | undefined): AiConfig[] {
  const templates = normalizeProviderTemplatesPayload(content)

  return templates.map((template: AiConfig) => ({
    ...template,
    templateKey: template.key,
    templateSource: 'remote' as const,
  }))
}

export async function getCachedProviderTemplates(): Promise<AiConfig[]> {
  const store = await Store.load('store.json')
  const cached = await store.get<ProviderTemplateCache>(PROVIDER_TEMPLATE_CACHE_KEY)

  if (!cached?.content?.providers?.length) {
    return []
  }

  return mapRemoteTemplates(cached.content)
}

function buildSignedHeaders(body: string) {
  const timestamp = new Date().toISOString()
  const nonce = crypto.randomUUID()
  const signature = buildUpgradeLinkSignature({
    body,
    nonce,
    secretKey: UPGRADE_LINK_SECRET_KEY,
    timestamp,
    uri: UPGRADE_LINK_UPGRADE_URI,
  })

  return {
    'Content-Type': 'application/json',
    'X-AccessKey': UPGRADE_LINK_ACCESS_KEY,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
  }
}

async function fetchRemoteProviderTemplates(versionCode?: number | null): Promise<ProviderTemplateCache | null> {
  const body = JSON.stringify({
    configurationKey: UPGRADE_LINK_CONFIGURATION_KEY,
    versionCode: versionCode || INITIAL_PROVIDER_TEMPLATE_VERSION_CODE,
    appointVersionCode: 0,
  })

  const response = await httpFetch(UPGRADE_LINK_UPGRADE_URL, {
    method: 'POST',
    headers: buildSignedHeaders(body),
    body,
  })

  if (!response.ok) {
    throw new Error(`Provider template request failed: ${response.status} ${response.statusText}`)
  }

  const result = await response.json() as {
    data?: {
      versionCode?: number
      versionName?: string
      content?: unknown
    }
  }

  const templates = normalizeProviderTemplatesPayload(result?.data?.content)
  if (templates.length === 0) {
    return null
  }

  return {
    versionCode: result?.data?.versionCode,
    versionName: result?.data?.versionName,
    fetchedAt: new Date().toISOString(),
    content: {
      providers: templates,
    },
  }
}

export async function loadProviderTemplates(builtinTemplates: AiConfig[]): Promise<AiConfig[]> {
  const store = await Store.load('store.json')
  const cached = await store.get<ProviderTemplateCache>(PROVIDER_TEMPLATE_CACHE_KEY)

  try {
    const latest = await fetchRemoteProviderTemplates(cached?.versionCode)
    if (latest) {
      await store.set(PROVIDER_TEMPLATE_CACHE_KEY, latest)
      return mapRemoteTemplates(latest.content)
    }
  } catch (error) {
    console.error('[provider-templates] failed to fetch remote templates', error)
  }

  if (cached?.content?.providers?.length) {
    return mapRemoteTemplates(cached.content)
  }

  return mapBuiltinTemplates(builtinTemplates)
}

export function getProviderTemplateMatch(currentConfig: AiConfig | undefined, templates: AiConfig[]) {
  return matchProviderTemplate({
    currentConfig,
    templates,
  }) as AiConfig | null
}
