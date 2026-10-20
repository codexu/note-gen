import { Store } from '@tauri-apps/plugin-store'
import bundledPolicy from '../../../config/notegen-model-policy.json'
import { fetchConfigCenterConfig } from '@/lib/config-center/client'

export interface NoteGenModelPolicy {
  schemaVersion: number
  title: string
  limited: { model: string; displayName: string; dailyRequestLimit: number }
  free: { model: string; displayName: string }
}

interface PolicyCache {
  versionCode: number
  content: NoteGenModelPolicy
}

export const NOTEGEN_POLICY_CHANGED = 'notegen-model-policy-changed'
const CACHE_KEY = 'noteGenModelPolicyCache'
let policy: NoteGenModelPolicy = bundledPolicy
let loading: Promise<NoteGenModelPolicy> | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizePolicy(value: unknown): NoteGenModelPolicy | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isString(value.title)) return null
  const { limited, free } = value
  if (!isRecord(limited) || !isRecord(free)) return null
  if (!isString(limited.model) || !isString(limited.displayName) || !isString(free.model) || !isString(free.displayName)) return null
  if (typeof limited.dailyRequestLimit !== 'number' || !Number.isSafeInteger(limited.dailyRequestLimit) || limited.dailyRequestLimit < 0) return null
  return {
    schemaVersion: 1,
    title: value.title.trim(),
    limited: { model: limited.model.trim(), displayName: limited.displayName.trim(), dailyRequestLimit: limited.dailyRequestLimit },
    free: { model: free.model.trim(), displayName: free.displayName.trim() },
  }
}

function applyPolicy(next: NoteGenModelPolicy) {
  policy = next
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTEGEN_POLICY_CHANGED))
}

export function getNoteGenModelPolicy(): NoteGenModelPolicy {
  return policy
}

export function loadNoteGenModelPolicy(): Promise<NoteGenModelPolicy> {
  // Fetch once per window; requests reuse the same policy until the next launch.
  loading ??= (async () => {
    try {
      const store = await Store.load('store.json')
      const cached = await store.get<PolicyCache>(CACHE_KEY)
      const cachedPolicy = normalizePolicy(cached?.content)
      if (cachedPolicy) applyPolicy(cachedPolicy)
      const result = await fetchConfigCenterConfig('noteGenModelPolicy', cachedPolicy ? cached?.versionCode : undefined)
      if (result.status === 'updated') {
        const next = normalizePolicy(result.payload)
        if (!next) throw new Error('Invalid NoteGen model policy')
        await store.set(CACHE_KEY, { versionCode: result.versionCode, content: next })
        await store.save()
        applyPolicy(next)
      }
    } catch (error) {
      console.debug('[notegen-model-policy] using cached or bundled policy:', error)
    }
    return policy
  })()
  return loading
}
