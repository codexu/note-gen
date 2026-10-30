import { BaseDirectory, mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { executeRecordTransaction, getDb, type RecordStatement } from '@/db'
import { authenticatedClient, getProfile, isSelfHostedAuthenticationError, isSelfHostedSecureStorageError } from './profile'
import { decryptPackedJson, encryptJson, loadWorkspaceKey, objectAssociatedData } from './crypto'
import { base64UrlByteLength, removeAssetUploadStaging } from './blob'
import { structuredPayload } from './outbox'
import { pendingPersonalChangesForEvent } from './pending-personal'
import { hydratePersonalAssets, personalAssetPaths, preparePersonalAssetsUpload } from './personal-assets'
import { isPersonalSyncKindEnabled } from './domains'
import type { SyncBootstrapPage, SyncEvent, SyncSession } from './protocol'

interface Context { workspaceId: string; profileId: string; workspaceType: 'account-data' | 'library' }
interface CommandRow { commandId: string; payload: string; sourceIds: string; state: string }
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => same(item, right[index]))
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return false
  const a = object(left), b = object(right)
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.prototype.hasOwnProperty.call(b, key) && same(a[key], b[key]))
}

// Keep independent field changes. On an overlapping edit the already accepted
// server value wins; the complete local version is durably archived first.
function merge(base: unknown, local: unknown, remote: unknown): unknown {
  if (same(local, base)) return remote
  if (same(remote, base) || same(local, remote)) return local
  if (base && local && remote && typeof base === 'object' && typeof local === 'object' && typeof remote === 'object'
    && !Array.isArray(base) && !Array.isArray(local) && !Array.isArray(remote)) {
    const a = object(base), b = object(local), c = object(remote)
    return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)])]
      .map(key => [key, merge(a[key], b[key], c[key])]).filter(([, value]) => value !== undefined))
  }
  return remote
}

function mergePayload(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>) {
  const result = object(merge(base, local, remote))
  // Numeric foreign keys are device-local. Transfer their stable references
  // together with the corresponding values, never independently per field.
  const keys = ['tagId', 'tagIds', 'tagUpdatedAt', 'relatedTagIds', 'conversationId']
  if (local.domain === 'canvas') keys.push('content')
  const relations = (payload: Record<string, unknown>): Record<string, unknown> => ({
    references: payload.references,
    ...Object.fromEntries(keys.map(key => [key, object(payload.value)[key]])),
  })
  const a = relations(base), b = relations(local), c = relations(remote)
  const selected = same(b, a) ? c : same(c, a) || same(b, c) ? b : c
  const value = { ...object(result.value) }
  for (const key of keys) {
    if (selected[key] === undefined) delete value[key]
    else value[key] = selected[key]
  }
  return { ...result, localKey: local.localKey, value, references: selected.references }
}

/** Rebase rejected personal snapshots without changing the platform-switch policy. */
export async function recoverPersonalRevisionConflicts(context: Context, session: SyncSession, errors: Set<string>) {
  if (context.workspaceType !== 'account-data') return false
  const database = await getDb()
  const rejected = await database.select<Array<{ objectId: string }>>(
    `select distinct json_extract(payload, '$.objectId') as objectId from self_hosted_outbox
     where workspace_id=$1 and state='blocked' and last_error_code='revision_conflict'
       and json_extract(payload, '$.type') in ('upsert-object','delete-object')`, [context.workspaceId],
  )
  if (!rejected.length) return false
  const { client } = await authenticatedClient(context.profileId)
  const profile = await getProfile(context.profileId)
  if (!profile) throw new Error('自托管同步配置不存在')
  const wanted = new Set(rejected.map(row => row.objectId))
  const remoteObjects = new Map<string, SyncBootstrapPage['objects'][number]>()
  await client.withBootstrapSnapshot(context.workspaceId, session.syncEpoch, async readPage => {
    let bootstrapId: string | undefined, after: string | undefined
    do {
      const page = await readPage(bootstrapId, after, session.limits.maxBootstrapObjectsPerPage)
      bootstrapId = page.bootstrapId
      for (const entry of page.objects) if (wanted.has(entry.objectId)) remoteObjects.set(entry.objectId, entry)
      after = page.nextObjectId ?? undefined
    } while (after)
  })
  let recovered = false
  for (const { objectId } of rejected) {
    try {
      const commands = await database.select<CommandRow[]>(
        `select command_id as commandId,payload,source_change_ids as sourceIds,state from self_hosted_outbox
         where workspace_id=$1 and json_extract(payload, '$.objectId')=$2
           and state in ('pending','retry','blocked') and json_extract(payload, '$.type') in ('upsert-object','delete-object')
         order by created_at, rowid`, [context.workspaceId, objectId],
      )
      if (!commands.length) continue
      const command = object(JSON.parse(commands[commands.length - 1].payload))
      const kind = String(command.kind)
      if (!isPersonalSyncKindEnabled(kind, profile.domainToggles, command.type === 'delete-object')) continue
      if (typeof command.keyVersion !== 'number' || typeof command.ciphertext !== 'string') continue
      const aad = objectAssociatedData(context.workspaceId, objectId, kind)
      const frozen = await decryptPackedJson<Record<string, unknown>>(
        await loadWorkspaceKey(context.workspaceId, command.keyVersion), command.ciphertext, aad,
      )
      if (typeof frozen.domain !== 'string') continue
      const remote = remoteObjects.get(objectId)
      if (remote && remote.kind !== kind) throw new Error('object_kind_mismatch')
      if (remote?.deletedAt && !isPersonalSyncKindEnabled(kind, profile.domainToggles, true)) continue
      const event: SyncEvent = {
        eventId: 'automatic-recovery', sequence: '0', commandId: '', sourceDeviceId: '',
        type: 'object.upserted', objectId, documentId: null, documentSequence: null,
        keyVersion: null, ciphertext: null, ciphertextHash: null, metadata: { kind }, createdAt: '',
      }
      const readChanges = async () => (await pendingPersonalChangesForEvent(context, event, frozen, true))
        .filter(change => change.domain === frozen.domain).sort((a, b) => a.id - b.id)
      const changes = await readChanges()
      const latest = changes[changes.length - 1]
      const deleting = latest ? latest.operation === 'delete' : command.type === 'delete-object'
      const mappings = await database.select<Array<{ identity: string }>>(
        'select local_identity as identity from self_hosted_object_mappings where workspace_id=$1 and object_id=$2',
        [context.workspaceId, objectId],
      )
      const localKey = latest?.localKey ?? mappings[0]?.identity.slice(frozen.domain.length + 1)
      const local = localKey ? await structuredPayload(context.workspaceId, frozen.domain, localKey) ?? frozen : frozen
      const bases = await database.select<Array<{ revision: string; payload: string }>>(
        'select revision,payload from self_hosted_remote_objects where workspace_id=$1 and object_id=$2', [context.workspaceId, objectId],
      )
      const base = bases[0]?.revision === command.baseRevision ? object(JSON.parse(bases[0].payload)) : {}
      const remotePayload = remote && remote.deletedAt === null
        ? await decryptPackedJson<Record<string, unknown>>(await loadWorkspaceKey(context.workspaceId, remote.keyVersion), remote.ciphertext, aad) : null
      const deleted = deleting || !!remote?.deletedAt
      let payload: Record<string, unknown> = deleted ? { version: 1, domain: frozen.domain, localKey, relativePath: localKey, deleted: true }
        : remotePayload ? mergePayload(base, local, remotePayload) : local
      const keyVersion = Math.max(1, ...session.keyVersions.map(key => key.keyVersion))
      let blobRefs: string[] = [], stagingIds: string[] = []
      if (!deleted && (frozen.domain === 'mark' || frozen.domain === 'message')) {
        const paths = new Set(personalAssetPaths(payload))
        const assets = new Map<string, unknown>()
        for (const source of [base, frozen, local, remotePayload ?? {}]) {
          for (const asset of Array.isArray(source.personalAssets) ? source.personalAssets : []) {
            const path = object(asset).path
            if (typeof path === 'string' && paths.has(path)) assets.set(path, asset)
          }
        }
        payload.personalAssets = [...assets.values()]
        // Remote fields may reference attachments this device has not received.
        await hydratePersonalAssets({ ...context, payload, enabled: profile.domainToggles.attachments !== false })
        const prepared = await preparePersonalAssetsUpload({ ...context, syncEpoch: session.syncEpoch, objectId, keyVersion,
          payload, enabled: profile.domainToggles.attachments !== false })
        if (prepared.deferred) continue
        payload = prepared.payload; blobRefs = prepared.blobRefs; stagingIds = prepared.stagingIds
      }
      const encrypted = await encryptJson(await loadWorkspaceKey(context.workspaceId, keyVersion), payload, aad)
      if (base64UrlByteLength(encrypted.packedCiphertext) > session.limits.maxObjectBytes) throw new Error('SELF_HOSTED_OBJECT_TOO_LARGE')
      // Capture both the rejected bytes and the latest editable row, including
      // edits queued after the original rejection, before retiring any source.
      const copyPath = `self-hosted-conflict-backups/${crypto.randomUUID()}.json`
      await mkdir('self-hosted-conflict-backups', { baseDir: BaseDirectory.AppData, recursive: true })
      await writeFile(copyPath, new TextEncoder().encode(JSON.stringify({ version: 1, workspaceId: context.workspaceId,
        objectId, commands, changes, base, local, remote: remotePayload, remoteObject: remote, merged: payload })), { baseDir: BaseDirectory.AppData })
      if (!same(changes, await readChanges())) continue
      const commandId = crypto.randomUUID(), now = Date.now()
      const replacement = {
        commandId, type: deleted ? 'delete-object' : 'upsert-object', objectId, kind,
        parentObjectId: remote?.parentObjectId ?? null, nameCiphertext: remote?.nameCiphertext ?? null,
        baseRevision: remote?.currentRevision ?? null, keyVersion, blobRefs: deleted ? remote?.blobRefs ?? [] : blobRefs,
        ciphertext: encrypted.packedCiphertext, ciphertextHash: encrypted.packedCiphertextHash,
        ...(deleted ? { expectedDocumentSequence: remote?.document?.latestDocumentSequence ?? '0', conflictId: crypto.randomUUID(),
          conflictCiphertext: encrypted.packedCiphertext, conflictCiphertextHash: encrypted.packedCiphertextHash } : {}),
      }
      const sourceIds = [...new Set([...changes.map(change => change.id), ...commands.flatMap(row => JSON.parse(row.sourceIds) as number[])])]
      const statements: RecordStatement[] = commands.flatMap(row => [
        { sql: `update self_hosted_outbox set state='superseded',last_error_code='automatically-rebased',updated_at=$1
            where command_id=$2 and state=$3 and payload=$4`, values: [now, row.commandId, row.state, row.payload], expectedRows: 1 },
        { sql: `update self_hosted_conflicts set state='resolved',resolved_at=$1,local_copy_path=$2
            where id=$3 and workspace_id=$4`, values: [now, copyPath, `revision-conflict:${row.commandId}`, context.workspaceId] },
      ])
      if (!(deleted && !remote)) statements.push(
        { sql: `insert into self_hosted_outbox(command_id,workspace_id,source_change_ids,command_type,payload,state,restore_local_snapshot,created_at,updated_at)
            values ($1,$2,$3,$4,$5,'pending',1,$6,$6)`,
          values: [commandId, context.workspaceId, JSON.stringify(sourceIds), replacement.type, JSON.stringify(replacement), now] },
      )
      // A deletion of an object absent from the authoritative snapshot is
      // already complete; the protocol cannot delete with a null revision.
      statements.push({ sql: `update self_hosted_local_changes set state=$3,updated_at=$1,last_error_code=null,next_attempt_at=0
          where id in (select value from json_each($2)) and state in ('pending','queued')`,
        values: [now, JSON.stringify(sourceIds), deleted && !remote ? 'superseded' : 'queued'] })
      await executeRecordTransaction(statements)
      recovered = true
      for (const id of stagingIds) await removeAssetUploadStaging(id).catch(error => console.warn('[self-hosted-sync] Recovery staging cleanup failed', error))
    } catch (error) {
      if (isSelfHostedAuthenticationError(error) || isSelfHostedSecureStorageError(error)) throw error
      errors.add('SELF_HOSTED_PERSONAL_REVISION_CONFLICT')
      console.warn('[self-hosted-sync] Personal conflict recovery will retry', { workspaceId: context.workspaceId, objectId, error })
    }
  }
  return recovered
}
