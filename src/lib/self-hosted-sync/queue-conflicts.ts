import { getDb } from '@/db'

export function queuedObjectId(alias: string) {
  return `coalesce(json_extract(${alias}.payload, '$.objectId'),
    json_extract(${alias}.payload, '$.objectResolution.objectId'),
    json_extract(${alias}.payload, '$.resolution.objectId'))`
}

// A rejected note write can stay local while independent objects sync. Keep
// the workspace fence for other commands whose effects cannot be scoped here.
export const isolatedNoteConflictPredicate = `
  blocked.state = 'blocked' and mapping.kind = 'note' and mapping.deleted_at is null
  and mapping.relative_path is not null and mapping.path_casefold is not null
  and (
    (blocked.last_error_code = 'revision_conflict' and blocked.command_type in ('upsert-object', 'delete-object')
      and json_extract(blocked.payload, '$.kind') = 'note'
      and exists (
        select 1 from self_hosted_conflicts recovery
        where recovery.id = 'revision-conflict:' || blocked.command_id
          and recovery.workspace_id = blocked.workspace_id and recovery.object_id = mapping.object_id
          and recovery.local_snapshot is not null and recovery.local_copy_path is not null
      ))
    or (blocked.last_error_code like 'editor-resolution:%'
      and blocked.command_type in ('create-conflict', 'resolve-conflict'))
  )`

export async function readLibraryQueueConflicts(workspaceId: string) {
  return (await getDb()).select<Array<{ commandId: string; objectId: string | null; pathCasefold: string | null }>>(
    `select blocked.command_id as commandId, mapping.object_id as objectId,
       case when ${isolatedNoteConflictPredicate} then mapping.path_casefold end as pathCasefold
     from self_hosted_outbox blocked
     left join self_hosted_object_mappings mapping on mapping.workspace_id = blocked.workspace_id
       and mapping.object_id = ${queuedObjectId('blocked')}
     where blocked.workspace_id = $1 and blocked.state = 'blocked'
       and (blocked.last_error_code = 'revision_conflict' or blocked.last_error_code like 'editor-resolution:%')`,
    [workspaceId],
  )
}
