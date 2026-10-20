import { invoke } from '@tauri-apps/api/core'
import { locale as getSystemLocale, platform as getPlatform } from '@tauri-apps/plugin-os'

import type { AiConfig } from '@/app/core/setting/config'

const CHINA_MAINLAND_STOREFRONT = 'CHN'
const OPENAI_TEMPLATE_KEYS = new Set(['chatgpt', 'openai'])

let cachedStorefrontCountryCode: string | null = null
let storefrontCountryCodePromise: Promise<string | null> | null = null

export function isBuiltInOpenAIProvider(config: AiConfig): boolean {
  if (config.templateSource === 'custom') {
    return false
  }

  const templateKey = (config.templateKey || config.key).trim().toLowerCase()
  if (OPENAI_TEMPLATE_KEYS.has(templateKey)) {
    return true
  }

  try {
    const hostname = new URL(config.baseURL || '').hostname.toLowerCase()
    return hostname === 'openai.com' || hostname.endsWith('.openai.com')
  } catch {
    return false
  }
}

export function excludeBuiltInOpenAIProviders(configs: AiConfig[]): AiConfig[] {
  return configs.filter(config => !isBuiltInOpenAIProvider(config))
}

export async function getAppStorefrontCountryCode(): Promise<string | null> {
  if (cachedStorefrontCountryCode) {
    return cachedStorefrontCountryCode
  }

  if (!storefrontCountryCodePromise) {
    storefrontCountryCodePromise = invoke<string | null>('get_app_storefront_country_code')
      .then(countryCode => {
        const normalizedCountryCode = countryCode?.trim().toUpperCase() || null
        if (normalizedCountryCode) {
          cachedStorefrontCountryCode = normalizedCountryCode
        }
        return normalizedCountryCode
      })
      .catch(error => {
        console.warn('[storefront-policy] failed to read App Store storefront', error)
        return null
      })
      .finally(() => {
        // StoreKit may not expose a storefront during early app startup. Do not
        // permanently cache that empty result; later callers should retry.
        storefrontCountryCodePromise = null
      })
  }

  return storefrontCountryCodePromise
}

export async function isMainlandChinaAppStore(): Promise<boolean> {
  const storefrontCountryCode = await getAppStorefrontCountryCode()
  if (storefrontCountryCode) {
    return storefrontCountryCode === CHINA_MAINLAND_STOREFRONT
  }

  // iOS must fail closed: if StoreKit is unavailable or has not returned a
  // trustworthy storefront yet, built-in OpenAI providers stay hidden.
  if (getPlatform() === 'ios') {
    return true
  }

  // Development builds and very early app startup may not have an App Store
  // storefront yet. Use the device region only as a conservative fallback;
  // an available StoreKit storefront always takes precedence.
  try {
    const systemLocale = await getSystemLocale()
    return /(?:^|[-_])CN$/i.test(systemLocale || '')
  } catch (error) {
    console.warn('[storefront-policy] failed to read system locale', error)
    return false
  }
}
