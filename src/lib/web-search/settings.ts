import { Store } from '@tauri-apps/plugin-store'
import type {
  AiConfig,
  ModelConfig,
  WebSearchApiKeys,
  WebSearchApiProvider,
  WebSearchProvider,
} from '@/app/core/setting/config'

const ENABLED_KEY = 'webSearch.enabled'
const NATIVE_ENABLED_KEY = 'webSearch.nativeEnabled'
const THIRD_PARTY_ENABLED_KEY = 'webSearch.thirdPartyEnabled'
const BASIC_ENABLED_KEY = 'webSearch.basicEnabled'
const PROVIDER_KEY = 'webSearch.provider'
const LEGACY_API_KEY = 'webSearch.apiKey'
const API_KEYS_KEY = 'webSearch.apiKeys'
const PROVIDER_ORDER_KEY = 'webSearch.providerOrder'

export const WEB_SEARCH_API_PROVIDERS: WebSearchApiProvider[] = [
  'zhipu',
  'tavily',
  'brave',
  'exa',
]

export interface WebSearchSettings {
  nativeEnabled: boolean
  thirdPartyEnabled: boolean
  basicEnabled: boolean
  provider: WebSearchProvider
  apiKeys: WebSearchApiKeys
  providerOrder: WebSearchApiProvider[]
}

interface WebSearchSettingsContext {
  aiConfigs?: AiConfig[]
  modelId?: unknown
}

const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  nativeEnabled: true,
  thirdPartyEnabled: true,
  basicEnabled: true,
  provider: 'auto',
  apiKeys: {},
  providerOrder: WEB_SEARCH_API_PROVIDERS,
}

export function normalizeWebSearchProviderOrder(value: unknown): WebSearchApiProvider[] {
  const configuredOrder = Array.isArray(value)
    ? value.filter((provider): provider is WebSearchApiProvider => (
        typeof provider === 'string'
        && WEB_SEARCH_API_PROVIDERS.includes(provider as WebSearchApiProvider)
      ))
    : []
  const uniqueOrder = [...new Set(configuredOrder)]
  return [
    ...uniqueOrder,
    ...WEB_SEARCH_API_PROVIDERS.filter(provider => !uniqueOrder.includes(provider)),
  ]
}

function normalizeApiKeys(value: unknown): WebSearchApiKeys {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return WEB_SEARCH_API_PROVIDERS.reduce<WebSearchApiKeys>((keys, provider) => {
    const apiKey = (value as Record<string, unknown>)[provider]
    if (typeof apiKey === 'string' && apiKey) keys[provider] = apiKey
    return keys
  }, {})
}

function isWebSearchProvider(value: unknown): value is WebSearchProvider {
  return value === 'auto'
    || value === 'zhipu'
    || value === 'tavily'
    || value === 'brave'
    || value === 'exa'
}

function findSelectedModel(aiConfigs: AiConfig[], modelId: unknown): ModelConfig | undefined {
  if (typeof modelId !== 'string' || !modelId) return undefined

  for (const config of aiConfigs) {
    const directMatch = config.models?.find(model => model.id === modelId)
    if (directMatch) return directMatch

    const expectedPrefix = `${config.key}-`
    if (modelId.startsWith(expectedPrefix)) {
      const originalModelId = modelId.substring(expectedPrefix.length)
      const combinedMatch = config.models?.find(model => model.id === originalModelId)
      if (combinedMatch) return combinedMatch
    }
  }

  return undefined
}

function findLegacySettings(
  aiConfigs: AiConfig[],
  modelId: unknown
): Pick<ModelConfig, 'enableWebSearch' | 'webSearchProvider' | 'webSearchApiKey'> | AiConfig | undefined {
  const selectedModel = findSelectedModel(aiConfigs, modelId)
  const candidates = [
    selectedModel,
    ...aiConfigs.flatMap(config => config.models || []),
    ...aiConfigs,
  ]

  return candidates.find(candidate =>
    candidate?.enableWebSearch !== undefined
    || candidate?.webSearchProvider !== undefined
    || candidate?.webSearchApiKey !== undefined
  )
}

export async function saveWebSearchSettings(
  settings: WebSearchSettings,
  targetStore?: Store
) {
  const store = targetStore || await Store.load('store.json')
  await store.set(
    ENABLED_KEY,
    settings.nativeEnabled || settings.thirdPartyEnabled || settings.basicEnabled
  )
  await store.set(NATIVE_ENABLED_KEY, settings.nativeEnabled)
  await store.set(THIRD_PARTY_ENABLED_KEY, settings.thirdPartyEnabled)
  await store.set(BASIC_ENABLED_KEY, settings.basicEnabled)
  await store.set(PROVIDER_KEY, 'auto')
  await store.set(API_KEYS_KEY, settings.apiKeys)
  await store.set(PROVIDER_ORDER_KEY, settings.providerOrder)
  await store.save()
}

export async function loadWebSearchSettings(
  targetStore?: Store,
  context: WebSearchSettingsContext = {}
): Promise<WebSearchSettings> {
  const store = targetStore || await Store.load('store.json')
  const [
    enabled,
    nativeEnabled,
    thirdPartyEnabled,
    basicEnabled,
    provider,
    apiKeys,
    legacyApiKey,
    providerOrder,
  ] = await Promise.all([
    store.get<boolean>(ENABLED_KEY),
    store.get<boolean>(NATIVE_ENABLED_KEY),
    store.get<boolean>(THIRD_PARTY_ENABLED_KEY),
    store.get<boolean>(BASIC_ENABLED_KEY),
    store.get<string>(PROVIDER_KEY),
    store.get<unknown>(API_KEYS_KEY),
    store.get<string>(LEGACY_API_KEY),
    store.get<unknown>(PROVIDER_ORDER_KEY),
  ])

  if (
    typeof enabled === 'boolean'
    || typeof nativeEnabled === 'boolean'
    || typeof thirdPartyEnabled === 'boolean'
    || typeof basicEnabled === 'boolean'
  ) {
    const legacyProvider = isWebSearchProvider(provider) ? provider : 'auto'
    const normalizedApiKeys = normalizeApiKeys(apiKeys)
    const legacyDisabled = enabled === false && typeof basicEnabled !== 'boolean'
    const legacyDefault = typeof enabled === 'boolean' ? enabled : true
    if (
      Object.keys(normalizedApiKeys).length === 0
      && legacyProvider !== 'auto'
      && typeof legacyApiKey === 'string'
      && legacyApiKey
    ) {
      normalizedApiKeys[legacyProvider] = legacyApiKey
    }

    const settings = {
      nativeEnabled: legacyDisabled
        ? false
        : typeof nativeEnabled === 'boolean' ? nativeEnabled : legacyDefault,
      thirdPartyEnabled: legacyDisabled
        ? false
        : typeof thirdPartyEnabled === 'boolean' ? thirdPartyEnabled : legacyDefault,
      basicEnabled: legacyDisabled
        ? false
        : typeof basicEnabled === 'boolean' ? basicEnabled : legacyDefault,
      provider: 'auto' as const,
      apiKeys: normalizedApiKeys,
      providerOrder: normalizeWebSearchProviderOrder(providerOrder),
    }
    if (
      legacyProvider !== 'auto'
      || nativeEnabled === undefined
      || thirdPartyEnabled === undefined
      || basicEnabled === undefined
      || providerOrder === undefined
      || (apiKeys === undefined && Object.keys(normalizedApiKeys).length > 0)
    ) {
      await saveWebSearchSettings(settings, store)
    }
    return settings
  }

  const aiConfigs = context.aiConfigs || await store.get<AiConfig[]>('aiModelList') || []
  const modelId = context.modelId ?? await store.get('primaryModel')
  const legacy = findLegacySettings(aiConfigs, modelId)
  if (!legacy) return DEFAULT_WEB_SEARCH_SETTINGS

  const legacyProvider = isWebSearchProvider(legacy.webSearchProvider)
    ? legacy.webSearchProvider
    : 'auto'
  const legacyEnabled = legacy.enableWebSearch === true
  const migrated: WebSearchSettings = {
    nativeEnabled: legacyEnabled,
    thirdPartyEnabled: legacyEnabled,
    basicEnabled: legacyEnabled,
    provider: 'auto',
    apiKeys: {},
    providerOrder: WEB_SEARCH_API_PROVIDERS,
  }
  if (
    legacyProvider !== 'auto'
    && typeof legacy.webSearchApiKey === 'string'
    && legacy.webSearchApiKey
  ) {
    migrated.apiKeys[legacyProvider] = legacy.webSearchApiKey
  }
  await saveWebSearchSettings(migrated, store)
  return migrated
}
