import { Store } from '@tauri-apps/plugin-store'
import { BaseDirectory, exists } from '@tauri-apps/plugin-fs'

// Device-local UI privacy only; never include this file in settings sync/export.
const STORE_PATH = 'app-lock.json'
const ITERATIONS = 600_000
const REMEMBER_DURATION_MS = 24 * 60 * 60 * 1000

export interface AppLockCredential {
  version: 1
  salt: string
  hash: string
}

async function loadAppLockStore() {
  const store = await Store.load(STORE_PATH, { autoSave: false })
  // Store.load ignores disk parse errors. Reload explicitly to fail closed if
  // an existing lock file is unreadable, rather than treating it as disabled.
  if (await exists(STORE_PATH, { baseDir: BaseDirectory.AppData })) await store.reload()
  return store
}

export async function readAppLock(): Promise<AppLockCredential | null> {
  const store = await loadAppLockStore()
  const value = await store.get<unknown>('credential')
  if (value === undefined || value === null) return null
  if (typeof value !== 'object'
    || !('version' in value) || value.version !== 1
    || !('salt' in value) || typeof value.salt !== 'string' || !/^[0-9a-f]{32}$/.test(value.salt)
    || !('hash' in value) || typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.hash)) {
    throw new Error('Invalid app lock configuration')
  }
  return { version: 1, salt: value.salt, hash: value.hash }
}

export async function isAppLockRemembered(): Promise<boolean> {
  const store = await loadAppLockStore()
  const expiresAt = await store.get<unknown>('rememberUntil')
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > Date.now()
}

export async function setAppLockRemembered(remember: boolean): Promise<void> {
  const store = await loadAppLockStore()
  const previous = await store.get<number>('rememberUntil')
  await store.set('rememberUntil', remember ? Date.now() + REMEMBER_DURATION_MS : null)
  try {
    await store.save()
  } catch (error) {
    await store.set('rememberUntil', previous ?? null)
    throw error
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function derive(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bytes = Uint8Array.from(salt.match(/../g) ?? [], byte => parseInt(byte, 16))
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes, iterations: ITERATIONS }, key, 256)
  return hex(new Uint8Array(bits))
}

export async function verifyAppLock(password: string, credential: AppLockCredential): Promise<boolean> {
  return await derive(password, credential.salt) === credential.hash
}

export async function saveAppLock(password: string | null): Promise<void> {
  const store = await loadAppLockStore()
  const previous = await store.get<AppLockCredential | null>('credential')
  const previousRememberUntil = await store.get<number | null>('rememberUntil')
  const salt = password === null ? '' : hex(crypto.getRandomValues(new Uint8Array(16)))
  const credential: AppLockCredential | null = password === null
    ? null
    : { version: 1, salt, hash: await derive(password, salt) }
  await store.set('credential', credential)
  await store.set('rememberUntil', null)
  try {
    await store.save()
  } catch (error) {
    // Do not report a failed save while retaining a different in-memory lock.
    await store.set('credential', previous)
    await store.set('rememberUntil', previousRememberUntil)
    throw error
  }
}
