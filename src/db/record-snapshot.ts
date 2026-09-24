import type { Mark } from './marks'
import type { Tag } from './tags'
import { executeRecordTransaction, type RecordStatement } from './index'
import { recordTagIds } from '@/lib/record-tags'

const recordTypes = new Set(['scan', 'text', 'image', 'link', 'file', 'recording', 'todo'])
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const nullableText = (value: unknown) => value == null || typeof value === 'string'

/** Validate the entire payload before issuing any destructive SQL. */
export function validateRecordSnapshot(value: unknown): asserts value is Mark[] {
  if (!Array.isArray(value)) throw new Error('Invalid remote records')
  const ids = new Set<number>()
  const sources = new Set<string>()
  for (const mark of value) {
    if (!mark || !positiveId(mark.id) || ids.has(mark.id) || !positiveId(mark.tagId) ||
      !recordTypes.has(mark.type) || !nullableText(mark.content) || !nullableText(mark.desc) ||
      !nullableText(mark.url) || !nullableText(mark.sourceId) ||
      (mark.deleted != null && mark.deleted !== 0 && mark.deleted !== 1) ||
      (mark.createdAt != null && !Number.isFinite(mark.createdAt)) ||
      (mark.tagIds != null && (!Array.isArray(mark.tagIds) || !mark.tagIds.every(positiveId))) ||
      (mark.tagUpdatedAt != null && !Number.isFinite(mark.tagUpdatedAt))) {
      throw new Error('Invalid remote record snapshot; local records were not replaced')
    }
    ids.add(mark.id)
    if (typeof mark.sourceId === 'string') {
      if (sources.has(mark.sourceId)) throw new Error('Duplicate remote record sourceId')
      sources.add(mark.sourceId)
    }
  }
}

export function tagSnapshotStatements(value: unknown): RecordStatement[] {
  if (!Array.isArray(value)) throw new Error('Invalid remote tags')
  const ids = new Set<number>()
  const statements: RecordStatement[] = [{ sql: 'delete from tags where isLocked = false', values: [] }]
  for (const tag of value) {
    if (!tag || !positiveId(tag.id) || ids.has(tag.id) || typeof tag.name !== 'string' ||
      (tag.sortOrder != null && !Number.isFinite(tag.sortOrder)) ||
      ![undefined, null, false, true, 0, 1].includes(tag.isLocked) ||
      ![undefined, null, false, true, 0, 1].includes(tag.isPin)) throw new Error('Invalid remote tag snapshot')
    ids.add(tag.id)
    if (tag.isLocked) continue
    statements.push({
      sql: `insert into tags (id, name, isLocked, isPin, sortOrder) values ($1, $2, 0, $3, $4)
        on conflict(id) do update set name = excluded.name, isPin = excluded.isPin, sortOrder = excluded.sortOrder
        where tags.isLocked = false`,
      values: [tag.id, tag.name, tag.isPin ?? false, tag.sortOrder ?? 0],
    })
  }
  return statements
}

export async function replaceRecordSnapshot(marks: Mark[], tags?: Tag[]) {
  validateRecordSnapshot(marks)
  const statements: RecordStatement[] = tags ? tagSnapshotStatements(tags) : []
  statements.push({ sql: 'delete from marks', values: [] })
  for (const mark of marks) {
    statements.push({
      sql: 'insert into marks (id, tagId, type, content, url, desc, deleted, createdAt, sourceId) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      values: [mark.id, mark.tagId, mark.type, mark.content ?? null, mark.url ?? null, mark.desc ?? null,
        mark.deleted ?? 0, mark.createdAt ?? null, mark.sourceId ?? crypto.randomUUID()],
    })
    if (Array.isArray(mark.tagIds)) statements.push({
      sql: 'insert into record_tag_metadata (markId, tagIds, updatedAt) values ($1,$2,$3)',
      values: [mark.id, JSON.stringify(recordTagIds(mark)), mark.tagUpdatedAt ?? 0],
    })
  }
  await executeRecordTransaction(statements)
  // Indexes are derived data, never a reason to report a committed import as failed.
  void import('@/lib/knowledge-index').then(({ reconcileStructuredKnowledgeSources }) =>
    reconcileStructuredKnowledgeSources()).catch(error => console.error('Record index refresh failed:', error))
}
