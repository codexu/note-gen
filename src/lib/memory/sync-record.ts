import type { MemorySyncRecord } from '@/db/memories'

/** Match the persisted sync columns. Optional SQL null and missing JSON fields
 * have the same meaning; embeddings and local usage/indexing data are excluded. */
export function normalizeMemorySyncRecord(memory: MemorySyncRecord): MemorySyncRecord {
  return {
    id: memory.id, content: memory.content, category: memory.category,
    kind: memory.kind, scopeType: memory.scopeType, scopeId: memory.scopeId ?? undefined,
    applyMode: memory.applyMode, status: memory.status, origin: memory.origin,
    confidence: memory.confidence, conflictKey: memory.conflictKey ?? undefined,
    replacedId: memory.replacedId ?? undefined, sensitivity: memory.sensitivity,
    archivedAt: memory.archivedAt ?? undefined,
    createdAt: memory.createdAt, updatedAt: memory.updatedAt,
  }
}
