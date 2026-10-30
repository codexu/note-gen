import type { Tag } from '@/db/tags'

export type TagSyncIdentityBaseline = Record<string, { localId: number; localName: string; remoteName: string }>

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

/** Keep local tag identities while translating independently allocated remote IDs.
 * Raw remote files stay unchanged; this is the state SQLite will actually keep. */
export function remapRemoteProtectedTags(remoteValue: Tag[], localValue: Tag[], previous: Record<string, number> = {}, baseline: TagSyncIdentityBaseline = {}) {
  const remote = normalizeTagSnapshot(remoteValue)
  const local = normalizeTagSnapshot(localValue)
  const protectedTags = local.filter(tag => tag.isLocked).sort((a, b) => a.id - b.id)
  const ids: Record<string, number> = {}
  const localById = new Map(local.map(tag => [tag.id, tag]))
  const canReuse = (tag: Tag, prior: number) => {
    const destination = localById.get(prior)
    if (!destination) return true
    if (destination.isLocked) return false
    if (destination.name === tag.name) return true
    const identity = baseline[String(tag.id)]
    return identity?.localId === prior && (identity.remoteName === tag.name || identity.localName === destination.name)
  }
  const protectedIds = new Set(protectedTags.map(tag => tag.id))
  const locked = remote.filter(tag => tag.isLocked).sort((a, b) => a.id - b.id)
  const matched = new Set<number>()
  const assign = (source: Tag, destination: Tag) => {
    ids[String(source.id)] = destination.id
    matched.add(destination.id)
  }
  // Match names before IDs: different providers can allocate the same default
  // labels in a different order, so numeric equality alone is not identity.
  for (const source of locked) {
    const target = protectedTags.find(tag => !matched.has(tag.id) && tag.name === source.name)
    if (target) assign(source, target)
  }
  for (const source of locked.filter(tag => ids[String(tag.id)] === undefined)) {
    const target = protectedTags.find(tag => !matched.has(tag.id) && tag.id === source.id)
    if (target) assign(source, target)
  }
  for (const source of locked.filter(tag => ids[String(tag.id)] === undefined)) {
    const target = protectedTags.find(tag => !matched.has(tag.id))
    if (target) assign(source, target)
  }
  const needsNewId = (tag: Tag) => {
    if (tag.isLocked) return protectedTags.length > 0
    const prior = previous[String(tag.id)]
    if (Number.isSafeInteger(prior) && prior > 0 && prior !== tag.id
      && canReuse(tag, prior)) return true
    const collision = localById.get(tag.id)
    return protectedIds.has(tag.id) || Boolean(collision && collision.name !== tag.name)
  }
  const used = new Set([...protectedIds, ...remote.filter(tag => !needsNewId(tag)).map(tag => tag.id)])
  let next = [...remote, ...local].reduce((max, tag) => Math.max(max, tag.id), 0)
  const allocate = (tag: Tag) => {
    const prior = previous[String(tag.id)]
    if (Number.isSafeInteger(prior) && prior > 0 && !used.has(prior)
      && canReuse(tag, prior)) {
      used.add(prior)
      return prior
    }
    // Reuse only a displaced tag's prior local representation. Do not merge
    // ordinary tags by name when their original remote ID is still usable.
    const candidates = local.filter(item => !item.isLocked && !used.has(item.id)
      && item.name === tag.name && item.isPin === tag.isPin && (item.sortOrder ?? 0) === (tag.sortOrder ?? 0))
    if (candidates.length === 1) {
      used.add(candidates[0].id)
      return candidates[0].id
    }
    do { next++ } while (used.has(next))
    if (!Number.isSafeInteger(next)) throw new Error('Invalid remote tag snapshot')
    used.add(next)
    return next
  }
  const tags = [...protectedTags]
  for (const tag of remote.slice().sort((a, b) => a.id - b.id)) {
    if (tag.isLocked && ids[String(tag.id)] !== undefined) continue
    const id = needsNewId(tag) ? allocate(tag) : tag.id
    ids[String(tag.id)] = id
    // Extra remote defaults must retain their names and references even when
    // this device has no remaining immutable default to pair with them.
    tags.push({ ...tag, id, isLocked: protectedTags.length ? false : tag.isLocked })
  }
  return { tags, ids }
}

/** A deliberate deletion invalidates every provider alias before an explicit
 * import can ever reuse that numeric local ID for a different tag. */
export async function invalidateLocalTagSyncIdentity(ids: number[]) {
  if (!ids.length) return
  const removed = new Set(ids)
  const store = await import('@tauri-apps/plugin-store').then(module => module.Store.load('store.json'))
  for (const [key, value] of await store.entries()) {
    if (!/^conversationSyncVersions:.*:tags:[a-f0-9]{64}$/.test(key)
      || !value || typeof value !== 'object' || Array.isArray(value)) continue
    const aliases = value as Record<string, number>
    await store.set(key, Object.fromEntries(Object.entries(aliases).filter(([, id]) => !removed.has(id))))
    const identity = await store.get<TagSyncIdentityBaseline>(`${key}:identity`) || {}
    await store.set(`${key}:identity`, Object.fromEntries(Object.entries(identity).filter(([, item]) => !removed.has(item.localId))))
  }
  await store.save()
}

/** Publish conversation dependencies in the target's namespace. Existing tags
 * may still be referenced by records outside this synchronization scope. */
export function projectConversationTagsForRemote(localValue: Tag[], remoteValue: Tag[], remoteToLocal: Record<string, number>, updateExisting = false) {
  const local = normalizeTagSnapshot(localValue)
  const tags = normalizeTagSnapshot(remoteValue)
  const used = new Set(tags.map(tag => tag.id))
  const localToRemote: Record<string, number> = {}
  const ids = { ...remoteToLocal }
  let next = [...local, ...tags].reduce((max, tag) => Math.max(max, tag.id), 0)
  for (const tag of local.slice().sort((a, b) => a.id - b.id)) {
    const source = tags.find(item => ids[String(item.id)] === tag.id)
    if (source) {
      localToRemote[String(tag.id)] = source.id
      if (updateExisting) tags[tags.indexOf(source)] = { ...tag, id: source.id,
        name: source.isLocked ? source.name : tag.name, isLocked: source.isLocked || tag.isLocked }
      continue
    }
    let id = tag.id
    if (used.has(id)) {
      do { next++ } while (used.has(next))
      if (!Number.isSafeInteger(next)) throw new Error('Invalid remote tag snapshot')
      id = next
    }
    used.add(id)
    tags.push({ ...tag, id })
    ids[String(id)] = tag.id
    localToRemote[String(tag.id)] = id
  }
  return { tags, ids, localToRemote }
}
