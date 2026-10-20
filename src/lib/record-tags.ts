import type { Mark } from '@/db/marks'
import type { Tag } from '@/db/tags'

/** Missing or malformed optional metadata must never make legacy records unreadable. */
export function recordTagIds(mark: Pick<Mark, 'tagId' | 'tagIds'>): number[] {
  const values: unknown[] = Array.isArray(mark.tagIds) ? mark.tagIds : []
  return [...new Set([mark.tagId, ...values].filter((id): id is number =>
    typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
  ))].sort((a, b) => a - b)
}

export function tagPathMatches(name: string, parent: string): boolean {
  return name === parent || name.startsWith(`${parent}/`)
}

export function recordMatchesTag(mark: Pick<Mark, 'tagId' | 'tagIds'>, tagId: number, tags: Tag[]): boolean {
  const ids = recordTagIds(mark)
  const parent = tags.find(tag => tag.id === tagId)
  return ids.includes(tagId) || Boolean(parent && tags.some(tag => ids.includes(tag.id) && tagPathMatches(tag.name, parent.name)))
}

/** Include virtual ancestors so 灵感/音乐 is filterable via 灵感 even without a parent row. */
export function tagPaths(tags: Tag[]): string[] {
  const paths = new Set<string>()
  for (const { name } of tags) {
    const parts = name.split('/')
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'))
  }
  return [...paths].sort((a, b) => a.localeCompare(b))
}

export type TagRules = { include: string[]; exclude: string[]; match: 'all' | 'any' }

export function normalizeTagRules(value?: Partial<TagRules>): TagRules {
  const paths = (items: unknown) => Array.isArray(items)
    ? [...new Set(items.filter((item): item is string => typeof item === 'string' && item.length > 0))]
    : []
  return { include: paths(value?.include), exclude: paths(value?.exclude), match: value?.match === 'any' ? 'any' : 'all' }
}

/** Resolve saved paths against a previous tag snapshot, including virtual parents. */
export function reconcileTagRules(rules: TagRules, previous: Tag[], tags: Tag[]): TagRules {
  const available = new Set(tagPaths(tags))
  const resolve = (path: string): string | undefined => {
    if (available.has(path)) return path
    const descendants = previous.filter(tag => tagPathMatches(tag.name, path))
    const candidates = new Set(descendants.flatMap(old => {
      const current = tags.find(tag => tag.id === old.id)
      if (!current) return []
      const suffix = old.name.slice(path.length)
      if (suffix && !current.name.endsWith(suffix)) return []
      const candidate = suffix ? current.name.slice(0, -suffix.length) : current.name
      return available.has(candidate) ? [candidate] : []
    }))
    return candidates.size === 1 ? [...candidates][0] : undefined
  }
  const remap = (paths: string[]) => [...new Set(paths.map(resolve).filter((path): path is string => Boolean(path)))]
  return { ...rules, include: remap(rules.include), exclude: remap(rules.exclude) }
}

export function matchesTagRules(mark: Mark, rules: TagRules, tags: Tag[]): boolean {
  const ids = recordTagIds(mark)
  const names = tags.filter(tag => ids.includes(tag.id)).map(tag => tag.name)
  const matches = (path: string) => names.some(name => tagPathMatches(name, path))
  return !rules.exclude.some(matches) && (rules.include.length === 0 ||
    (rules.match === 'all' ? rules.include.every(matches) : rules.include.some(matches)))
}

export function preserveLegacyRecordTags(remote: Mark[], local: Mark[]): Mark[] {
  const bySource = new Map(local.filter(mark => mark.sourceId).map(mark => [mark.sourceId, mark]))
  const byId = new Map(local.map(mark => [mark.id, mark]))
  return remote.map(mark => {
    if (Array.isArray(mark.tagIds)) return { ...mark, tagIds: recordTagIds(mark) }
    const previous = mark.sourceId ? bySource.get(mark.sourceId) : byId.get(mark.id)
    if (!previous || (previous.sourceId && mark.sourceId && previous.sourceId !== mark.sourceId)) return mark
    return { ...mark, tagIds: recordTagIds({ ...mark, tagIds: recordTagIds(previous).filter(id => id !== previous.tagId) }), tagUpdatedAt: previous.tagUpdatedAt }
  })
}

/** Tags have their own clock: editing them must not rewrite record creation time. */
export function mergeRecordTags(local: Mark, remote: Mark, content: Mark): Mark {
  const legacyRemote = !Array.isArray(remote.tagIds)
  const winner = legacyRemote || (local.tagUpdatedAt || 0) > (remote.tagUpdatedAt || 0) ? local : remote
  const tagId = legacyRemote ? content.tagId : winner.tagId
  return {
    ...content,
    tagId,
    tagIds: recordTagIds({ tagId, tagIds: recordTagIds(winner).filter(id => id !== winner.tagId) }),
    tagUpdatedAt: winner.tagUpdatedAt || 0,
  }
}
