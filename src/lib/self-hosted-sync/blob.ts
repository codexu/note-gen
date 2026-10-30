import { invoke } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { getDb } from '@/db'
import { authenticatedClient } from './profile'
import { loadWorkspaceKey } from './crypto'
import { withAssetUploadStaging } from './blob-staging'
import { withSelfHostedRequestScope } from './client'
export { removeAssetUploadStaging } from './blob-staging'

interface EncryptedBytes {
  packedCiphertext: string
  packedCiphertextHash: string
}

interface AssetUploadInput {
  profileId: string
  workspaceId: string
  syncEpoch: string
  localRoot: string
  relativePath: string
  keyVersion: number
  signal?: AbortSignal
}

export function uploadAsset(input: AssetUploadInput) {
  return withSelfHostedRequestScope(async signal => {
    const absolutePath = await join(input.localRoot, input.relativePath)
    signal.throwIfAborted()
    const plaintext = await readFile(absolutePath)
    signal.throwIfAborted()
    return uploadAssetBytes({ ...input, plaintext, signal })
  }, input.signal)
}

/** Upload bytes already read from a validated managed attachment path. */
export function uploadAssetBytes(input: AssetUploadInput & { plaintext: Uint8Array }) {
  return withSelfHostedRequestScope(signal => uploadAssetBytesInScope({ ...input, signal }), input.signal)
}

async function uploadAssetBytesInScope(input: AssetUploadInput & { plaintext: Uint8Array; signal: AbortSignal }) {
  const signal = input.signal
  const plaintext = input.plaintext
  const plaintextHash = await hashBytes(plaintext)
  signal.throwIfAborted()
  const key = await loadWorkspaceKey(input.workspaceId, input.keyVersion)
  signal.throwIfAborted()
  const associatedData = assetAssociatedData(input.workspaceId, input.relativePath)
  return withAssetUploadStaging({
    profileId: input.profileId, workspaceId: input.workspaceId, syncEpoch: input.syncEpoch,
    localRoot: input.localRoot, relativePath: input.relativePath, keyVersion: input.keyVersion, plaintextHash,
  }, async () => {
    signal.throwIfAborted()
    const encrypted = await invoke<EncryptedBytes>('self_hosted_encrypt_bytes', {
      key, plaintext: bytesToBase64Url(plaintext), associatedData,
    })
    signal.throwIfAborted()
    return base64UrlToBytes(encrypted.packedCiphertext)
  }, async ({ stagingId, ciphertext, ciphertextHash }) => {
    signal.throwIfAborted()
    const { client } = await authenticatedClient(input.profileId)
    signal.throwIfAborted()
    const upload = await client.createBlobUpload(input.workspaceId, {
      blobId: ciphertextHash,
      expectedSize: String(ciphertext.byteLength),
      ciphertextHash,
      expectedSyncEpoch: input.syncEpoch,
    }, signal)
    signal.throwIfAborted()
    if (upload.blobId !== ciphertextHash) throw new Error('blob_upload_identity_mismatch')
    if (!upload.alreadyExists && (!upload.uploadId || !Number.isSafeInteger(upload.partBytes) || upload.partBytes <= 0)) {
      throw new Error('blob_upload_session_invalid')
    }
    const database = await getDb()
    signal.throwIfAborted()
    await database.execute(
      `insert into self_hosted_blob_uploads(
         workspace_id, blob_id, upload_id, local_path, expected_size,
         ciphertext_hash, uploaded_parts, state, expires_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict(workspace_id, blob_id) do update set
         upload_id = excluded.upload_id, local_path = excluded.local_path,
         uploaded_parts = excluded.uploaded_parts, state = excluded.state,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      [
        input.workspaceId, upload.blobId, upload.uploadId, input.relativePath,
        String(ciphertext.byteLength), ciphertextHash,
        JSON.stringify(upload.uploadedParts), upload.alreadyExists ? 'complete' : 'uploading',
        upload.expiresAt ? Date.parse(upload.expiresAt) : null, Date.now(),
      ]
    )
    signal.throwIfAborted()
    if (!upload.alreadyExists && upload.uploadId) {
      const uploaded = new Set(upload.uploadedParts.map(part => part.partNumber))
      let partNumber = 1
      for (let offset = 0; offset < ciphertext.length; offset += upload.partBytes, partNumber++) {
        signal.throwIfAborted()
        if (uploaded.has(partNumber)) continue
        await client.uploadBlobPart(
          input.workspaceId,
          upload.uploadId,
          partNumber,
          ciphertext.slice(offset, offset + upload.partBytes),
          signal,
        )
        signal.throwIfAborted()
        uploaded.add(partNumber)
        await database.execute(
          `update self_hosted_blob_uploads set uploaded_parts = $1, updated_at = $2
           where workspace_id = $3 and blob_id = $4`,
          [JSON.stringify([...uploaded]), Date.now(), input.workspaceId, upload.blobId]
        )
        signal.throwIfAborted()
      }
      const completed = await client.completeBlobUpload(input.workspaceId, upload.uploadId, input.syncEpoch, signal)
      signal.throwIfAborted()
      if (completed.blobId !== ciphertextHash || completed.ciphertextHash !== ciphertextHash
        || completed.size !== String(ciphertext.byteLength)) throw new Error('blob_upload_completion_mismatch')
      await database.execute(
        `update self_hosted_blob_uploads set state = 'complete', updated_at = $1
         where workspace_id = $2 and blob_id = $3`,
        [Date.now(), input.workspaceId, upload.blobId]
      )
      signal.throwIfAborted()
    }
    return {
      blobId: upload.blobId,
      plaintextHash,
      size: plaintext.byteLength,
      associatedData,
      stagingId,
    }
  })
}

export async function downloadAsset(input: {
  profileId: string
  workspaceId: string
  blobId: string
  relativePath: string
  keyVersion: number
  associatedData?: string
  signal?: AbortSignal
}) {
  return withSelfHostedRequestScope(async signal => {
    const { client } = await authenticatedClient(input.profileId)
    signal.throwIfAborted()
    const ciphertext = await client.downloadBlob(input.workspaceId, input.blobId, signal)
    signal.throwIfAborted()
    if (await hashBytes(ciphertext) !== input.blobId) throw new Error('blob_ciphertext_hash_mismatch')
    const key = await loadWorkspaceKey(input.workspaceId, input.keyVersion)
    signal.throwIfAborted()
    const associatedData = input.associatedData ?? assetAssociatedData(input.workspaceId, input.relativePath)
    const prefix = `notegen:blob:v1:${input.workspaceId}:`
    if (!associatedData.startsWith(prefix) || associatedData.length === prefix.length) {
      throw new Error('blob_associated_data_invalid')
    }
    const plaintext = await invoke<string>('self_hosted_decrypt_packed_bytes', {
      key,
      packedCiphertext: bytesToBase64Url(ciphertext),
      // Renames keep the original blob bytes, so authentication must use the
      // path recorded at encryption time rather than the current display path.
      associatedData,
    })
    const bytes = base64UrlToBytes(plaintext)
    return { bytes, hash: await hashBytes(bytes) }
  }, input.signal)
}

export function bytesToBase64Url(value: Uint8Array) {
  let binary = ''
  value.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
}

export function base64UrlByteLength(value: string) {
  return base64UrlToBytes(value).byteLength
}

export async function hashBytes(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer))
  return bytesToBase64Url(digest)
}

export function assetAssociatedData(workspaceId: string, relativePath: string) {
  return `notegen:blob:v1:${workspaceId}:${relativePath}`
}
