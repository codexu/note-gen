import { Store } from '@tauri-apps/plugin-store'

import type { AiConfig } from '@/app/core/setting/config'
import { fetchConfigCenterConfig } from '@/lib/config-center/client'

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

async function fetchProviderTemplatesFromConfigCenter(versionCode?: number | null): Promise<ProviderTemplateCache | null> {
  const result = await fetchConfigCenterConfig('providerTemplates', versionCode)
  if (result.status === 'not-modified') {
    return null
  }

  const templates = normalizeProviderTemplatesPayload(result.payload)
  if (templates.length === 0) {
    throw new Error('Config center provider templates payload is empty')
  }

  return {
    versionCode: result.versionCode,
    versionName: result.versionName,
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
    const latest = await fetchProviderTemplatesFromConfigCenter(cached?.versionCode)
    if (latest) {
      await store.set(PROVIDER_TEMPLATE_CACHE_KEY, latest)
      await store.save()
      return mapRemoteTemplates(latest.content)
    }

    if (cached?.content?.providers?.length) {
      return mapRemoteTemplates(cached.content)
    }
  } catch (error) {
    console.error('[provider-templates] failed to fetch config center templates', error)
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
