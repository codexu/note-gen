import { invoke } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { getDb } from '@/db'
import { authenticatedClient } from './profile'
import { loadWorkspaceKey } from './crypto'

interface EncryptedBytes {
  packedCiphertext: string
  packedCiphertextHash: string
}

export async function uploadAsset(input: {
  profileId: string
  workspaceId: string
  syncEpoch: string
  localRoot: string
  relativePath: string
  keyVersion: number
}) {
  const absolutePath = await join(input.localRoot, input.relativePath)
  const plaintext = await readFile(absolutePath)
  const key = await loadWorkspaceKey(input.workspaceId, input.keyVersion)
  const associatedData = assetAssociatedData(input.workspaceId, input.relativePath)
  const encrypted = await invoke<EncryptedBytes>('self_hosted_encrypt_bytes', {
    key,
    plaintext: bytesToBase64Url(plaintext),
    associatedData,
  })
  const ciphertext = base64UrlToBytes(encrypted.packedCiphertext)
  const { client } = await authenticatedClient(input.profileId)
  const upload = await client.createBlobUpload(input.workspaceId, {
    blobId: encrypted.packedCiphertextHash,
    expectedSize: String(ciphertext.byteLength),
    ciphertextHash: encrypted.packedCiphertextHash,
    expectedSyncEpoch: input.syncEpoch,
  })
  const database = await getDb()
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
      String(ciphertext.byteLength), encrypted.packedCiphertextHash,
      JSON.stringify(upload.uploadedParts), upload.alreadyExists ? 'complete' : 'uploading',
      upload.expiresAt ? Date.parse(upload.expiresAt) : null, Date.now(),
    ]
  )
  if (!upload.alreadyExists && upload.uploadId) {
    const uploaded = new Set(upload.uploadedParts.map(part => part.partNumber))
    let partNumber = 1
    for (let offset = 0; offset < ciphertext.length; offset += upload.partBytes, partNumber++) {
      if (uploaded.has(partNumber)) continue
      await client.uploadBlobPart(
        input.workspaceId,
        upload.uploadId,
        partNumber,
        ciphertext.slice(offset, offset + upload.partBytes),
      )
      uploaded.add(partNumber)
      await database.execute(
        `update self_hosted_blob_uploads set uploaded_parts = $1, updated_at = $2
         where workspace_id = $3 and blob_id = $4`,
        [JSON.stringify([...uploaded]), Date.now(), input.workspaceId, upload.blobId]
      )
    }
    await client.completeBlobUpload(input.workspaceId, upload.uploadId, input.syncEpoch)
    await database.execute(
      `update self_hosted_blob_uploads set state = 'complete', updated_at = $1
       where workspace_id = $2 and blob_id = $3`,
      [Date.now(), input.workspaceId, upload.blobId]
    )
  }
  return {
    blobId: upload.blobId,
    plaintextHash: await hashBytes(plaintext),
    size: plaintext.byteLength,
    associatedData,
  }
}

export async function downloadAsset(input: {
  profileId: string
  workspaceId: string
  blobId: string
  relativePath: string
  keyVersion: number
}) {
  const { client } = await authenticatedClient(input.profileId)
  const ciphertext = await client.downloadBlob(input.workspaceId, input.blobId)
  if (await hashBytes(ciphertext) !== input.blobId) throw new Error('blob_ciphertext_hash_mismatch')
  const key = await loadWorkspaceKey(input.workspaceId, input.keyVersion)
  const plaintext = await invoke<string>('self_hosted_decrypt_packed_bytes', {
    key,
    packedCiphertext: bytesToBase64Url(ciphertext),
    associatedData: assetAssociatedData(input.workspaceId, input.relativePath),
  })
  const bytes = base64UrlToBytes(plaintext)
  return { bytes, hash: await hashBytes(bytes) }
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

function assetAssociatedData(workspaceId: string, relativePath: string) {
  return `notegen:blob:v1:${workspaceId}:${relativePath}`
}
