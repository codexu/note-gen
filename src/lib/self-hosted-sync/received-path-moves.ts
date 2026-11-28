import { getDb } from '@/db'

interface ReceivedPathMove {
  objectId: string
  source: string
  target: string
}

export async function readReceivedFolderMoves(workspaceId: string) {
  return (await getDb()).select<Array<{ source: string; target: string; mappedDescendant: number }>>(
    `select f.source_path as source, f.target_path as target,
       exists(select 1 from self_hosted_object_mappings m where m.workspace_id=f.workspace_id and m.deleted_at is null
         and substr(m.relative_path,1,length(f.source_path)+1)=f.source_path||'/') as mappedDescendant
     from self_hosted_received_folder_moves f where f.workspace_id=$1 order by length(f.source_path) desc`, [workspaceId],
  )
}

export async function readReceivedPathMoves(workspaceId: string): Promise<ReceivedPathMove[]> {
  const rows = await (await getDb()).select<Array<{
    objectId: string; mappedPath: string; sourcePath: string; targetPath: string
  }>>(
    `select j.object_id as objectId, m.relative_path as mappedPath,
       j.source_path as sourcePath, j.target_path as targetPath
     from self_hosted_file_journal j join self_hosted_object_mappings m
       on m.workspace_id = j.workspace_id and m.object_id = j.object_id
     where j.workspace_id = $1 and j.operation = 'received-move' and j.state in ('prepared', 'committed')
       and m.relative_path is not null and m.deleted_at is null`,
    [workspaceId],
  )
  const moves: ReceivedPathMove[] = []
  for (const row of rows) {
    const sourcePath = row.sourcePath.replaceAll('\\', '/')
    const targetPath = row.targetPath.replaceAll('\\', '/')
    const mappedSuffix = `/${row.mappedPath}`
    // Native moves use a canonical root. The mapping may already point to
    // the destination after a crash between the remap and the snapshot write.
    const rootPrefix = [sourcePath, targetPath]
      .filter(path => path.endsWith(mappedSuffix))
      .map(path => path.slice(0, -row.mappedPath.length))
      .filter(prefix => sourcePath.startsWith(prefix) && targetPath.startsWith(prefix))
      .sort((a, b) => a.length - b.length)[0]
    if (rootPrefix) moves.push({
      objectId: row.objectId,
      source: sourcePath.slice(rootPrefix.length),
      target: targetPath.slice(rootPrefix.length),
    })
  }
  return moves
}
