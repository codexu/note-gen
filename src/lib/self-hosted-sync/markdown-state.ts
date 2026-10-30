import * as Y from 'yjs'
import { getDb } from '@/db'
import { decryptPackedJson, loadWorkspaceKey, objectAssociatedData } from './crypto'

const activeDocuments = new Map<string, number>()

export function trackMarkdownCollaboration(workspaceId: string, objectId: string): () => void {
  const key = `${workspaceId}\0${objectId}`
  activeDocuments.set(key, (activeDocuments.get(key) ?? 0) + 1)
  return () => {
    const remaining = (activeDocuments.get(key) ?? 1) - 1
    if (remaining > 0) activeDocuments.set(key, remaining)
    else activeDocuments.delete(key)
  }
}

export function hasMarkdownCollaboration(workspaceId: string, objectId: string): boolean {
  return activeDocuments.has(`${workspaceId}\0${objectId}`)
}

// Only durable CRDT bytes can justify discarding a rejected file snapshot.
// An editor's in-memory text alone is not evidence that its edits are safe.
export async function persistedMarkdownMatches(workspaceId: string, objectId: string, content: string): Promise<boolean> {
  const database = await getDb()
  const checkpoints = await database.select<Array<{ sequence: string; payload: string; keyVersion: number }>>(
    `select document_sequence as sequence, payload, key_version as keyVersion
     from self_hosted_yjs_updates where workspace_id=$1 and object_id=$2 and event_type='checkpoint'
     order by cast(document_sequence as integer) desc limit 1`, [workspaceId, objectId],
  )
  const checkpoint = checkpoints[0]
  const updates = await database.select<Array<{ payload: string; keyVersion: number }>>(
    `select payload, key_version as keyVersion from self_hosted_yjs_updates
     where workspace_id=$1 and object_id=$2 and cast(document_sequence as integer)>cast($3 as integer)
     order by cast(document_sequence as integer)`, [workspaceId, objectId, checkpoint?.sequence ?? '0'],
  )
  const local = await database.select<Array<{ payload: string }>>(
    `select payload from self_hosted_outbox where workspace_id=$1
     and command_type in ('append-update','commit-checkpoint') and state not in ('superseded','failed')
     and json_extract(payload,'$.objectId')=$2 order by created_at,rowid`, [workspaceId, objectId],
  )
  const document = new Y.Doc()
  const legacy = document.getText('markdown')
  const v2 = document.getMap<Y.Text>('markdown-v2')
  const text = document.getText('markdown-v3')
  const metadata = document.getMap('markdown-v3-meta')
  const apply = async (payload: string, keyVersion: number) => {
    const envelope = await decryptPackedJson<{ format: string; update: string }>(
      await loadWorkspaceKey(workspaceId, keyVersion), payload, objectAssociatedData(workspaceId, objectId, 'note'),
    )
    if (envelope.format !== 'yjs-v1' || typeof envelope.update !== 'string') throw new Error('invalid_markdown_update')
    const base64 = envelope.update.replaceAll('-', '+').replaceAll('_', '/')
    Y.applyUpdate(document, Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), char => char.charCodeAt(0)))
  }
  try {
    if (checkpoint) await apply(checkpoint.payload, checkpoint.keyVersion)
    for (const update of updates) await apply(update.payload, update.keyVersion)
    for (const row of local) {
      const command = JSON.parse(row.payload) as { ciphertext: string; keyVersion: number }
      await apply(command.ciphertext, command.keyVersion)
    }
    // Unresolved Yjs dependencies must never be mistaken for complete text.
    if (document.store.pendingStructs || document.store.pendingDs) return false
    if (metadata.get('initialized') === true) return text.toString() === content
    const legacyV2 = v2.get('content')
    if (legacyV2 instanceof Y.Text) return legacyV2.toString() === content
    return legacy.length > 0 && legacy.toString() === content
  } finally {
    document.destroy()
  }
}
