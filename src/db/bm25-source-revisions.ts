import { initCanvasesDb } from './canvases'
import { db, executeRecordTransaction } from './index'
import type { Tag } from './tags'

interface RecordRevision {
  id: number
  tagId: number
  tagIds: string | null
  revision: string
}

interface CanvasRevision {
  id: string
  revision: string
}

/** Records have no edit timestamp. Keep a token in the same transaction as each source write. */
async function ensureSourceRevisions() {
  await initCanvasesDb()
  const installed = await db.select<{ name: string }[]>(
    "select name from sqlite_master where type = 'trigger' and name = 'bm25_canvas_delete_v1'",
  )
  if (installed.length) return

  const statements = [
    'create table if not exists bm25_source_revisions (source_key text primary key, revision text not null)',
  ]
  for (const [type, table, columns] of [
    ['record', 'marks', 'id, type, content, url, desc, createdAt, deleted, tagId, sourceId'],
    ['canvas', 'canvases', 'id, title, canvasType, content, deletedAt'],
  ]) {
    const writeToken = `insert into bm25_source_revisions (source_key, revision)
      values ('${type}:' || new.id, hex(randomblob(16)))
      on conflict(source_key) do update set revision = excluded.revision;`
    statements.push(
      `insert or ignore into bm25_source_revisions (source_key, revision)
       select '${type}:' || id, hex(randomblob(16)) from ${table}`,
      `create trigger if not exists bm25_${type}_insert_v1 after insert on ${table}
       begin ${writeToken} end`,
      `create trigger if not exists bm25_${type}_update_v1 after update of ${columns} on ${table}
       begin ${writeToken} end`,
      `create trigger if not exists bm25_${type}_delete_v1 after delete on ${table}
       begin delete from bm25_source_revisions where source_key = '${type}:' || old.id; end`,
    )
  }
  await executeRecordTransaction(statements.map(sql => ({ sql, values: [] })))
}

export async function getBM25StructuredSourceRevisions() {
  await ensureSourceRevisions()
  const [records, canvases, tags] = await Promise.all([
    db.select<RecordRevision[]>(`
      select m.id, m.tagId, t.tagIds, r.revision from marks m
      join bm25_source_revisions r on r.source_key = 'record:' || m.id
      left join record_tag_metadata t on t.markId = m.id where m.deleted = 0
    `),
    db.select<CanvasRevision[]>(`
      select c.id, r.revision from canvases c
      join bm25_source_revisions r on r.source_key = 'canvas:' || c.id where c.deletedAt is null
    `),
    db.select<Tag[]>('select id, name from tags'),
  ])
  return { records, canvases, tags }
}

export async function isBM25SourceRevisionCurrent(sourceKey: string, expected: string) {
  const rows = await db.select<{ revision: string }[]>(
    'select revision from bm25_source_revisions where source_key = $1', [sourceKey],
  )
  return rows[0]?.revision === expected
}
