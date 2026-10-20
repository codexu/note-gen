import { invoke } from '@tauri-apps/api/core'
import { secureGet } from './profile'

export interface EncryptedPayload {
  nonce: string
  ciphertext: string
  ciphertextHash: string
  packedCiphertext: string
  packedCiphertextHash: string
}

export function objectAssociatedData(workspaceId: string, objectId: string, kind: string) {
  return `notegen:sync:v1:${workspaceId}:${objectId}:${kind}`
}

export async function encryptJson(key: string, value: unknown, associatedData: string) {
  return invoke<EncryptedPayload>('self_hosted_encrypt', {
    key,
    plaintext: JSON.stringify(value),
    associatedData,
  })
}

export async function decryptJson<T>(
  key: string,
  nonce: string,
  ciphertext: string,
  associatedData: string,
): Promise<T> {
  const plaintext = await invoke<string>('self_hosted_decrypt', {
    key, nonce, ciphertext, associatedData,
  })
  return JSON.parse(plaintext) as T
}

export function decryptText(
  key: string,
  nonce: string,
  ciphertext: string,
  associatedData: string,
) {
  return invoke<string>('self_hosted_decrypt', {
    key, nonce, ciphertext, associatedData,
  })
}

export async function decryptPackedJson<T>(
  key: string,
  packedCiphertext: string,
  associatedData: string,
): Promise<T> {
  const plaintext = await invoke<string>('self_hosted_decrypt_packed', {
    key, packedCiphertext, associatedData,
  })
  return JSON.parse(plaintext) as T
}

export async function loadWorkspaceKey(workspaceId: string, keyVersion: number) {
  const key = await secureGet(`workspace.${workspaceId}.key.${keyVersion}`)
  if (!key) throw new Error(`工作区密钥不可用：${workspaceId} v${keyVersion}`)
  return key
}

export function encodeUtf8Base64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
