import { Store } from '@tauri-apps/plugin-store'

import builtinRecommendations from '../../../config/recommended-skills.json'
import { fetchConfigCenterConfig } from '@/lib/config-center/client'

export interface RecommendedSkill {
  id: string
  name: Record<string, string>
  description: Record<string, string>
  author: string
  sourceUrl: string
}

interface RecommendedSkillsConfig {
  schemaVersion: 1
  skills: RecommendedSkill[]
}

interface RecommendedSkillsCache {
  versionCode: number
  content: RecommendedSkillsConfig
}

const RECOMMENDED_SKILLS_CACHE_KEY = 'recommendedSkillsCache'
let pendingLoad: Promise<RecommendedSkill[]> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeLocalizedText(value: unknown): Record<string, string> | null {
  if (!isRecord(value) || !isNonEmptyString(value.en)) return null

  const entries = Object.entries(value)
  if (entries.some(([locale, text]) => !locale.trim() || !isNonEmptyString(text))) return null

  return Object.fromEntries(entries.map(([locale, text]) => [locale, String(text).trim()]))
}

function isSourceUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function normalizeConfig(payload: unknown): RecommendedSkillsConfig | null {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.skills)) return null

  const skills: RecommendedSkill[] = []
  const ids = new Set<string>()
  for (const item of payload.skills) {
    if (!isRecord(item) || !isNonEmptyString(item.id)
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || item.id.length > 64
      || ids.has(item.id) || !isNonEmptyString(item.author) || !isSourceUrl(item.sourceUrl)) {
      return null
    }

    const name = normalizeLocalizedText(item.name)
    const description = normalizeLocalizedText(item.description)
    if (!name || !description) return null

    ids.add(item.id)
    skills.push({
      id: item.id,
      name,
      description,
      author: item.author.trim(),
      sourceUrl: item.sourceUrl.trim(),
    })
  }

  // An empty list is valid: publishing one removes all recommendations.
  return { schemaVersion: 1, skills }
}

function normalizeCache(payload: unknown): RecommendedSkillsCache | null {
  if (!isRecord(payload) || typeof payload.versionCode !== 'number'
    || !Number.isSafeInteger(payload.versionCode) || payload.versionCode < 0) return null

  const content = normalizeConfig(payload.content)
  return content ? { versionCode: payload.versionCode, content } : null
}

export function getRecommendedSkillText(text: Record<string, string>, locale: string): string {
  return text[locale] || text[locale.split('-')[0]] || text.en || Object.values(text)[0] || ''
}

async function fetchRecommendations(): Promise<RecommendedSkill[]> {
  let store: Store | null = null
  let cached: RecommendedSkillsCache | null = null
  try {
    store = await Store.load('store.json')
    cached = normalizeCache(await store.get<unknown>(RECOMMENDED_SKILLS_CACHE_KEY))
  } catch (error) {
    console.error('[skills] Failed to read recommendations cache:', error)
  }

  try {
    const result = await fetchConfigCenterConfig('recommendedSkills', cached?.versionCode)
    if (result.status === 'updated') {
      const content = normalizeConfig(result.payload)
      if (!content || !Number.isSafeInteger(result.versionCode) || result.versionCode < 0) {
        throw new Error('Config center returned an invalid recommended Skills list')
      }

      if (store) {
        try {
          await store.set(RECOMMENDED_SKILLS_CACHE_KEY, {
            versionCode: result.versionCode,
            content,
          } satisfies RecommendedSkillsCache)
          await store.save()
        } catch (error) {
          console.error('[skills] Failed to save recommendations cache:', error)
        }
      }
      return content.skills
    }
  } catch (error) {
    console.error('[skills] Failed to fetch recommendations:', error)
  }

  return cached?.content.skills ?? normalizeConfig(builtinRecommendations)?.skills ?? []
}

export function loadRecommendedSkills(): Promise<RecommendedSkill[]> {
  if (!pendingLoad) {
    pendingLoad = fetchRecommendations().finally(() => {
      pendingLoad = null
    })
  }
  return pendingLoad
}
