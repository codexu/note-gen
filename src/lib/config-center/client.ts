import { fetch as httpFetch } from '@tauri-apps/plugin-http'

import type {
  ConfigCenterConfigKey,
  ConfigCenterEntry,
  ConfigCenterFetchResult,
  ConfigCenterManifest,
} from './types'

const CONFIG_CENTER_SCHEMA_VERSION = 1
const CONFIG_CENTER_MANIFEST_URL = 'https://download.notegen.top/config/v1/config-manifest.json'
const CONFIG_CENTER_MANIFEST_TIMEOUT_MS = 3000
const CONFIG_CENTER_CONFIG_TIMEOUT_MS = 5000

type HttpFetchOptions = NonNullable<Parameters<typeof httpFetch>[1]>

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isVersionCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
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

function normalizeManifestEntry(value: unknown): ConfigCenterEntry | null {
  if (!isRecord(value) || !isVersionCode(value.versionCode) || !isValidUrl(value.url)) {
    return null
  }

  return {
    versionCode: value.versionCode,
    versionName: isNonEmptyString(value.versionName) ? value.versionName.trim() : undefined,
    url: value.url.trim(),
  }
}

function normalizeManifest(payload: unknown): ConfigCenterManifest | null {
  if (!isRecord(payload) || payload.schemaVersion !== CONFIG_CENTER_SCHEMA_VERSION || !isRecord(payload.configs)) {
    return null
  }

  return {
    schemaVersion: CONFIG_CENTER_SCHEMA_VERSION,
    updatedAt: isNonEmptyString(payload.updatedAt) ? payload.updatedAt.trim() : undefined,
    configs: {
      providerTemplates: normalizeManifestEntry(payload.configs.providerTemplates) ?? undefined,
      noteGenDefaultModels: normalizeManifestEntry(payload.configs.noteGenDefaultModels) ?? undefined,
    },
  }
}

export async function fetchWithTimeout(
  url: string,
  init: HttpFetchOptions,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof httpFetch>>> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort()
      reject(new Error(`Request timed out after ${timeoutMs}ms: ${url}`))
    }, timeoutMs)
  })

  try {
    const options = {
      ...init,
      signal: controller?.signal,
      timeout: timeoutMs,
    } as HttpFetchOptions

    return await Promise.race([httpFetch(url, options), timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  } as HttpFetchOptions, timeoutMs)

  if (!response.ok) {
    throw new Error(`Config center request failed: ${response.status} ${response.statusText}`)
  }

  const payload = await response.json() as unknown
  if (!isRecord(payload)) {
    throw new Error(`Config center returned invalid JSON payload: ${url}`)
  }

  return payload
}

export async function fetchConfigCenterManifest(): Promise<ConfigCenterManifest> {
  const payload = await fetchJson(CONFIG_CENTER_MANIFEST_URL, CONFIG_CENTER_MANIFEST_TIMEOUT_MS)
  const manifest = normalizeManifest(payload)

  if (!manifest) {
    throw new Error('Config center manifest is invalid')
  }

  return manifest
}

export async function fetchConfigCenterConfig(
  configKey: ConfigCenterConfigKey,
  cachedVersionCode?: number | null,
): Promise<ConfigCenterFetchResult> {
  const manifest = await fetchConfigCenterManifest()
  const entry = manifest.configs[configKey]

  if (!entry) {
    throw new Error(`Config center manifest is missing ${configKey}`)
  }

  if (isVersionCode(cachedVersionCode) && entry.versionCode <= cachedVersionCode) {
    return {
      status: 'not-modified',
    }
  }

  const payload = await fetchJson(entry.url, CONFIG_CENTER_CONFIG_TIMEOUT_MS)

  return {
    status: 'updated',
    versionCode: entry.versionCode,
    versionName: entry.versionName,
    payload,
  }
}
