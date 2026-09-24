import type { Mark } from '@/db/marks'
import type { RecordSortMode } from '@/lib/record-display-preferences'
import type { Tag } from '@/db/tags'
import { normalizeTagRules, matchesTagRules, recordMatchesTag, type TagRules } from '@/lib/record-tags'

type RecordTimePreset = 'all' | 'today' | 'last7Days' | 'last30Days'

type RecordFiltersLike = {
  search: string
  selectedTypes: Mark['type'][]
  timePreset: RecordTimePreset
  tagId: number | 'all'
  tagRules: TagRules
}

const DAY_IN_MS = 24 * 60 * 60 * 1000
const VALID_TYPES = new Set<Mark['type']>(['scan', 'text', 'image', 'link', 'file', 'recording', 'todo'])
const VALID_TIME_PRESETS = new Set<RecordTimePreset>(['all', 'today', 'last7Days', 'last30Days'])

function normalizeText(value?: string | null): string {
  return (value || '').trim().toLowerCase()
}

function matchesTimePreset(createdAt: number, timePreset: RecordTimePreset, now: string | Date): boolean {
  if (timePreset === 'all') {
    return true
  }

  const createdTime = new Date(createdAt).getTime()
  const nowDate = new Date(now)

  if (Number.isNaN(createdTime) || Number.isNaN(nowDate.getTime())) {
    return false
  }

  if (timePreset === 'today') {
    return new Date(createdAt).toDateString() === nowDate.toDateString()
  }

  const diffMs = nowDate.getTime() - createdTime
  if (diffMs < 0) {
    return false
  }

  if (timePreset === 'last7Days') {
    return diffMs <= 7 * DAY_IN_MS
  }

  if (timePreset === 'last30Days') {
    return diffMs <= 30 * DAY_IN_MS
  }

  return true
}

function matchesSearch(mark: Pick<Mark, 'content' | 'desc' | 'url'>, search: string): boolean {
  if (!search) {
    return true
  }

  const haystack = [mark.content, mark.desc, mark.url]
    .map((value) => normalizeText(value))
    .join(' ')

  return haystack.includes(search)
}

export function normalizeRecordFilters(filters?: Partial<RecordFiltersLike>): RecordFiltersLike {
  const search = typeof filters?.search === 'string' ? filters.search : ''
  const selectedTypes = Array.isArray(filters?.selectedTypes)
    ? filters.selectedTypes.filter((type): type is Mark['type'] => VALID_TYPES.has(type))
    : []
  const timePreset: RecordTimePreset = filters?.timePreset && VALID_TIME_PRESETS.has(filters.timePreset) ? filters.timePreset : 'all'
  const parsedTagId = typeof filters?.tagId === 'string' ? Number(filters.tagId) : filters?.tagId
  const tagId: RecordFiltersLike['tagId'] = typeof parsedTagId === 'number' && Number.isInteger(parsedTagId) && parsedTagId > 0
    ? parsedTagId
    : 'all'

  return {
    search,
    selectedTypes,
    timePreset,
    tagId,
    tagRules: normalizeTagRules(filters?.tagRules),
  }
}

export function getTrashRecordFilters(): RecordFiltersLike {
  return {
    search: '',
    selectedTypes: [],
    timePreset: 'all',
    tagId: 'all',
    tagRules: normalizeTagRules(),
  }
}

export function buildRecordFilterSummary(filters?: Partial<RecordFiltersLike>) {
  const normalized = normalizeRecordFilters(filters)

  return {
    hasFilters: Boolean(
      normalized.search.trim() ||
      normalized.selectedTypes.length > 0 ||
      normalized.timePreset !== 'all'
    ),
    search: normalized.search.trim(),
    typeCount: normalized.selectedTypes.length,
    timePreset: normalized.timePreset,
    hasTag: false,
  }
}

export function filterMarks(
  marks: Mark[],
  filters?: Partial<RecordFiltersLike> & { now?: string | Date },
  tags: Tag[] = [],
) {
  const normalizedFilters = normalizeRecordFilters(filters)
  const search = normalizeText(normalizedFilters.search)
  const selectedTypes = new Set(normalizedFilters.selectedTypes)
  const timePreset = normalizedFilters.timePreset
  const tagId = normalizedFilters.tagId
  const now = filters?.now || new Date().toISOString()

  return marks.filter((mark) => {
    if (selectedTypes.size > 0 && !selectedTypes.has(mark.type)) {
      return false
    }

    if (tagId !== 'all' && !recordMatchesTag(mark, tagId, tags)) {
      return false
    }

    if (!matchesTimePreset(mark.createdAt, timePreset, now)) {
      return false
    }

    return matchesSearch(mark, search) && matchesTagRules(mark, normalizedFilters.tagRules, tags)
  })
}

export function sortMarks(marks: Mark[], sortMode: RecordSortMode) {
  return [...marks].sort((left, right) => {
    if (sortMode === 'oldest') {
      return left.createdAt - right.createdAt
    }

    if (sortMode === 'type') {
      const typeOrder = left.type.localeCompare(right.type)
      return typeOrder !== 0 ? typeOrder : right.createdAt - left.createdAt
    }

    return right.createdAt - left.createdAt
  })
}
