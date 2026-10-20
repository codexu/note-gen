import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'

const ACTIVE_OCR_PROVIDER_STORE_KEY = 'activeOcrProviderId'

export interface OcrProviderPackage {
  id: string
  name: string
  version: string
  platform: string
  builtin: boolean
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

async function getStore() {
  return Store.load('store.json')
}

export async function getInstalledOcrProviders(): Promise<OcrProviderPackage[]> {
  return invoke<OcrProviderPackage[]>('list_ocr_providers')
}

export async function getActiveOcrProviderId(): Promise<string | null> {
  const store = await getStore()
  const activeProviderId = await store.get<string>(ACTIVE_OCR_PROVIDER_STORE_KEY)
  return isString(activeProviderId) ? activeProviderId : null
}

export async function getActiveOcrProvider(): Promise<OcrProviderPackage | null> {
  const providers = await getInstalledOcrProviders()
  const activeProviderId = await getActiveOcrProviderId()

  if (activeProviderId) {
    const activeProvider = providers.find((item) => item.id === activeProviderId)
    if (activeProvider) {
      return activeProvider
    }
  }

  return providers[0] || null
}

export async function setActiveOcrProviderId(providerId: string): Promise<void> {
  const store = await getStore()
  await store.set(ACTIVE_OCR_PROVIDER_STORE_KEY, providerId)
  await store.save()
}

export async function runInstalledOcrProvider({
  providerId,
  imagePath,
  languages,
}: {
  providerId: string
  imagePath: string
  languages: string[]
}): Promise<string> {
  return invoke<string>('run_ocr_provider', {
    providerId,
    imagePath,
    languages,
  })
}
