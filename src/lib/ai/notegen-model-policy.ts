import { Store } from '@tauri-apps/plugin-store'
import bundledPolicy from '../../../config/notegen-model-policy.json'
import { fetchNoteGenModelPolicy } from '@/lib/config-center/client'

export interface NoteGenModelPolicy {
  schemaVersion: number
  title: string
  limited: { model: string; displayName: string; dailyTokenLimit: number }
  free: { model: string; displayName: string }
}

interface PolicyCache {
  versionCode: number
  content: NoteGenModelPolicy
}

export const NOTEGEN_POLICY_CHANGED = 'notegen-model-policy-changed'
const DEFAULT_DAILY_TOKEN_LIMIT = 1_000_000
const CACHE_KEY = 'noteGenModelPolicyCache'
const REFRESH_INTERVAL_MS = 60_000
let policy: NoteGenModelPolicy = {
  ...bundledPolicy,
  limited: { ...bundledPolicy.limited, dailyTokenLimit: DEFAULT_DAILY_TOKEN_LIMIT },
}
let loading: Promise<NoteGenModelPolicy> | undefined
let lastLoadedAt = 0

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
  // Older config-center payloads only contain the request-count allowance.
  const dailyTokenLimit = limited.dailyTokenLimit ?? DEFAULT_DAILY_TOKEN_LIMIT
  if (typeof dailyTokenLimit !== 'number' || !Number.isSafeInteger(dailyTokenLimit) || dailyTokenLimit < 0) return null
  return {
    schemaVersion: 1,
    title: value.title.trim(),
    limited: { model: limited.model.trim(), displayName: limited.displayName.trim(), dailyTokenLimit },
    free: { model: free.model.trim(), displayName: free.displayName.trim() },
  }
}

function applyPolicy(next: NoteGenModelPolicy) {
  if (JSON.stringify(policy) === JSON.stringify(next)) return
  policy = next
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTEGEN_POLICY_CHANGED))
}

export function getNoteGenModelPolicy(): NoteGenModelPolicy {
  return policy
}

export function loadNoteGenModelPolicy(): Promise<NoteGenModelPolicy> {
  if (loading) return loading
  if (lastLoadedAt && Date.now() - lastLoadedAt < REFRESH_INTERVAL_MS) return Promise.resolve(policy)
  loading = (async () => {
    try {
      const next = normalizePolicy(await fetchNoteGenModelPolicy())
      if (!next) throw new Error('Invalid NoteGen model policy')
      applyPolicy(next)
      try {
        const store = await Store.load('store.json')
        await store.set(CACHE_KEY, { versionCode: 0, content: next })
        await store.save()
      } catch (error) {
        console.debug('[notegen-model-policy] failed to cache policy:', error)
      }
    } catch (error) {
      // Cached model names remain useful offline, but never retain a stale quota.
      let fallback = policy
      try {
        const store = await Store.load('store.json')
        const cached = await store.get<PolicyCache>(CACHE_KEY)
        fallback = normalizePolicy(cached?.content) ?? policy
      } catch {
        // The bundled policy also works when local storage is unavailable.
      }
      applyPolicy({ ...fallback, limited: { ...fallback.limited, dailyTokenLimit: DEFAULT_DAILY_TOKEN_LIMIT } })
      console.debug('[notegen-model-policy] using default token allowance:', error)
    }
    lastLoadedAt = Date.now()
    return policy
  })().finally(() => { loading = undefined })
  return loading
}
