import type { SyncBootstrapPage } from './protocol'

export interface SelfHostedSnapshotObject {
  object: SyncBootstrapPage['objects'][number]
  payload: Record<string, unknown>
}

/** A deleted conversation also deletes its messages, including old servers'
 * leftover live message objects. Missing parents without a tombstone stay
 * untouched so callers can still report an incomplete remote snapshot. */
export function applyConversationTombstones(entries: SelfHostedSnapshotObject[]): SelfHostedSnapshotObject[] {
  const deletedConversations = new Map(entries
    .filter(entry => entry.object.kind === 'conversation' && entry.object.deletedAt !== null)
    .map(entry => [entry.object.objectId, entry.object.deletedAt!]))
  if (!deletedConversations.size) return entries
  return entries.map(entry => {
    if (entry.object.kind !== 'message' || entry.object.deletedAt !== null) return entry
    const references = entry.payload.references
    if (!references || typeof references !== 'object' || Array.isArray(references)) return entry
    const parent = (references as Record<string, unknown>).conversation
    const deletedAt = typeof parent === 'string' ? deletedConversations.get(parent) : undefined
    return deletedAt ? { ...entry, object: { ...entry.object, deletedAt } } : entry
  })
}
