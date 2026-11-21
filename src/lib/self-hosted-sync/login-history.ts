import { normalizeServerUrl } from './client'

export interface SelfHostedLoginEntry {
  accountId: string
  instanceId: string
  login: string
}

const MAX_RECENT_ACCOUNTS = 8

function storageKey(serverUrl: string) {
  return `selfHostedLoginHistory:${normalizeServerUrl(serverUrl).url}`
}

function readHistory(key: string): SelfHostedLoginEntry[] {
  const raw = localStorage.getItem(key)
  let value: unknown
  try {
    value = raw === null ? [] : JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  return value.filter((entry: unknown): entry is SelfHostedLoginEntry =>
    typeof entry === 'object' && entry !== null
      && 'accountId' in entry && typeof entry.accountId === 'string' && Boolean(entry.accountId)
      && 'instanceId' in entry && typeof entry.instanceId === 'string' && Boolean(entry.instanceId)
      && 'login' in entry && typeof entry.login === 'string' && Boolean(entry.login.trim()),
  ).slice(0, MAX_RECENT_ACCOUNTS)
}

function normalizeLogin(value: string) {
  return value.trim().normalize('NFKC').toLocaleLowerCase('und')
}

export function listSelfHostedLogins(serverUrl: string, instanceId?: string) {
  try {
    const entries = readHistory(storageKey(serverUrl))
    const currentInstanceId = instanceId ?? entries[0]?.instanceId
    return entries.filter(entry => entry.instanceId === currentInstanceId)
  } catch {
    return []
  }
}

export function rememberSelfHostedLogin(serverUrl: string, entry: SelfHostedLoginEntry) {
  const login = entry.login.trim()
  if (!login) return
  try {
    const key = storageKey(serverUrl)
    const remaining = readHistory(key)
      .filter(previous => previous.instanceId === entry.instanceId
        && previous.accountId !== entry.accountId && normalizeLogin(previous.login) !== normalizeLogin(login))
    localStorage.setItem(key, JSON.stringify([
      { accountId: entry.accountId, instanceId: entry.instanceId, login },
      ...remaining,
    ].slice(0, MAX_RECENT_ACCOUNTS)))
  } catch {
    // Login remains usable when the local history cannot be saved.
  }
}

export function findSelfHostedLogin(serverUrl: string, instanceId: string, login: string) {
  const key = normalizeLogin(login)
  return listSelfHostedLogins(serverUrl, instanceId).find(entry => normalizeLogin(entry.login) === key)
}
