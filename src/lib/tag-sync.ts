import type { Tag } from '@/db/tags'

export function normalizeTagBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true
  if (value === false || value === 0 || value == null) return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return undefined
}

export function normalizeTagSnapshot(value: unknown): Tag[] {
  if (!Array.isArray(value)) throw new Error('Invalid remote tags')
  const ids = new Set<number>()

  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Invalid remote tag snapshot')
    }
    const tag = entry as Tag
    const isLocked = normalizeTagBoolean(tag.isLocked)
    const isPin = normalizeTagBoolean(tag.isPin)
    if (typeof tag.id !== 'number' || !Number.isSafeInteger(tag.id) || tag.id <= 0
      || ids.has(tag.id) || typeof tag.name !== 'string'
      || (tag.sortOrder != null && !Number.isFinite(tag.sortOrder))
      || isLocked === undefined || isPin === undefined) {
      throw new Error('Invalid remote tag snapshot')
    }
    ids.add(tag.id)
    return { ...tag, isLocked, isPin }
  })
}
