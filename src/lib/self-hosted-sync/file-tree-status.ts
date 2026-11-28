import { getDb } from '@/db'

export type SelfHostedFileStatus = 'synced' | 'dirty' | 'error'

export async function loadSelfHostedFileTreeStatus(workspaceRoot: string) {
  const database = await getDb()
  const rows = await database.select<Array<{ path: string; status: SelfHostedFileStatus }>>(
    `with binding as (
       select b.workspace_id from self_hosted_workspace_bindings b
       join self_hosted_sync_profiles p on p.id = b.profile_id
       where b.workspace_type = 'library' and b.binding_state = 'bound' and b.local_root = $1
         and p.state in ('connected', 'reauthentication-required')
       order by (p.state = 'connected') desc, p.updated_at desc, p.id, b.updated_at desc
       limit 1
     ), pending_documents as (
       select distinct json_extract(o.payload, '$.objectId') as object_id
       from self_hosted_outbox o join binding b on b.workspace_id = o.workspace_id
       where o.state in ('pending', 'retry', 'blocked')
         and o.command_type in ('append-update', 'commit-checkpoint')
     )
     select m.relative_path as path, case
       when exists (select 1 from self_hosted_conflicts c
         where c.workspace_id = m.workspace_id and c.object_id = m.object_id and c.state = 'unresolved')
         or exists (select 1 from self_hosted_local_changes l
           where l.workspace_id = m.workspace_id and l.local_key = m.relative_path
             and l.domain in ('file', 'asset', 'folder') and l.state = 'failed')
         then 'error'
       when exists (select 1 from self_hosted_local_changes l
         where l.workspace_id = m.workspace_id and l.local_key = m.relative_path
           and l.domain in ('file', 'asset', 'folder') and l.state in ('pending', 'queued'))
         or m.object_id in (select object_id from pending_documents)
         then 'dirty'
       else 'synced'
     end as status
     from self_hosted_object_mappings m join binding b on b.workspace_id = m.workspace_id
     where m.relative_path is not null and m.deleted_at is null
       and exists (select 1 from self_hosted_revisions r
         where r.workspace_id = m.workspace_id and r.object_id = m.object_id)`,
    [workspaceRoot],
  )
  return new Map(rows.map(({ path, status }) => [path.normalize('NFC'), status]))
}
