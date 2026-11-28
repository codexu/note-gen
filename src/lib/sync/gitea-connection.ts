import { Store } from '@tauri-apps/plugin-store'
import { GITEA_INSTANCES, GiteaInstanceType } from './gitea.types'

const connectionKey = 'giteaConnection'
export const giteaLegacyConnectionKeys = [
  'giteaInstanceType', 'giteaCustomUrl', 'giteaAccessToken', 'giteaUsername', 'giteaBranch',
] as const
export const giteaConnectionStoreKeys = [connectionKey, ...giteaLegacyConnectionKeys] as const

export interface GiteaConnection {
  instanceType: GiteaInstanceType
  customUrl: string
  token: string
  username: string
  account: string
  branch: string
  revision: string
  repositoryScope: string
}

const emptyConnection: GiteaConnection = {
  instanceType: GiteaInstanceType.OFFICIAL, customUrl: '', token: '', username: '',
  account: '', branch: '', revision: '', repositoryScope: '',
}

let connectionQueue: Promise<unknown> = Promise.resolve()
let persistenceUncertain = false

function withConnection<T>(operation: (store: Store) => Promise<T>): Promise<T> {
  const result = connectionQueue.then(async () => operation(await Store.load('store.json')))
  connectionQueue = result.catch(() => undefined)
  return result
}

function normalizeCustomUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw || /[\s\\?#]/u.test(raw) || raw.startsWith('/')) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`)
    if (!['http:', 'https:'].includes(url.protocol)
      || !url.hostname || url.username || url.password) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export function getGiteaEndpoint({ instanceType, customUrl }: Pick<GiteaConnection, 'instanceType' | 'customUrl'>) {
  if (instanceType === GiteaInstanceType.OFFICIAL) return GITEA_INSTANCES[instanceType].baseUrl
  return normalizeCustomUrl(customUrl)
}

function clearIdentity(connection: GiteaConnection): GiteaConnection {
  return { ...connection, token: '', username: '', account: '', branch: '' }
}

function parseConnection(value: unknown): GiteaConnection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...emptyConnection, repositoryScope: 'invalid' }
  const record = value as Record<string, unknown>
  const { instanceType, customUrl, token, username, account, branch, revision, repositoryScope } = record
  if ((instanceType !== GiteaInstanceType.OFFICIAL && instanceType !== GiteaInstanceType.SELF_HOSTED)
    || typeof customUrl !== 'string' || typeof token !== 'string' || typeof username !== 'string'
    || typeof account !== 'string' || typeof branch !== 'string' || typeof revision !== 'string'
    || typeof repositoryScope !== 'string') return { ...emptyConnection, repositoryScope: 'invalid' }
  const connection = { instanceType, customUrl, token, username, account, branch, revision, repositoryScope }
  return !getGiteaEndpoint(connection) ? clearIdentity(connection) : connection
}

async function saveConnection(store: Store, next: GiteaConnection, previous: unknown) {
  try {
    await store.set(connectionKey, next)
    await store.save()
    persistenceUncertain = false
  } catch (error) {
    persistenceUncertain = true
    try {
      if (previous === undefined) await store.delete(connectionKey)
      else await store.set(connectionKey, previous)
      await store.save()
      persistenceUncertain = false
    } catch {
      // A failed rollback cannot authorize requests until the next successful write.
    }
    throw error
  }
}

function migrateLegacyConnection([type, rawUrl, token, username, branch]: unknown[]): GiteaConnection {
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  const instanceType = type === GiteaInstanceType.SELF_HOSTED ? GiteaInstanceType.SELF_HOSTED : GiteaInstanceType.OFFICIAL
  const customUrl = text(rawUrl)
  const endpoint = getGiteaEndpoint({ instanceType, customUrl })
  // A legacy official selection with a different custom endpoint might have
  // been overwritten by synced settings or by the old instance selector.
  const malformed = [rawUrl, token, username, branch].some(value => value != null && typeof value !== 'string')
  const ambiguous = Boolean(type && type !== instanceType) || malformed
    || (instanceType === GiteaInstanceType.OFFICIAL && customUrl !== '' && normalizeCustomUrl(customUrl) !== endpoint)
  const keepCredentials = Boolean(endpoint && !ambiguous && text(token))
  return {
    instanceType,
    customUrl,
    token: keepCredentials ? text(token) : '',
    username: keepCredentials ? text(username) : '',
    account: keepCredentials ? text(username) : '',
    branch: keepCredentials ? text(branch) : '',
    revision: crypto.randomUUID(),
    repositoryScope: ambiguous || !endpoint ? crypto.randomUUID() : '',
  }
}

async function removeLegacyConnection(store: Store) {
  try {
    for (const key of giteaLegacyConnectionKeys) await store.delete(key)
    await store.save()
  } catch {
    // Only the complete connection record is authoritative once it has been saved.
  }
}

async function readConnection(store: Store): Promise<GiteaConnection> {
  const stored = await store.get(connectionKey)
  if (stored !== undefined) {
    const connection = parseConnection(stored)
    return persistenceUncertain ? clearIdentity({ ...connection, revision: '' }) : connection
  }
  const legacy = await Promise.all(giteaLegacyConnectionKeys.map(key => store.get(key)))
  if (persistenceUncertain || !legacy.some(Boolean)) return { ...emptyConnection }
  const next = migrateLegacyConnection(legacy)
  await saveConnection(store, next, undefined)
  await removeLegacyConnection(store)
  return next
}

export function getGiteaConnection() {
  return withConnection(readConnection)
}

/** Import one connection from the selected file, without using this device's legacy values. */
export function importGiteaConnection(settings: Record<string, unknown>): Promise<void> {
  return withConnection(async store => {
    const connection = Object.hasOwn(settings, connectionKey)
      ? parseConnection(settings[connectionKey])
      : migrateLegacyConnection(giteaLegacyConnectionKeys.map(key => settings[key]))
    await saveConnection(store, { ...connection, revision: crypto.randomUUID() }, await store.get(connectionKey))
    await removeLegacyConnection(store)
  })
}

export function setGiteaEndpoint(patch: Partial<Pick<GiteaConnection, 'instanceType' | 'customUrl'>>) {
  return withConnection(async store => {
    const current = await readConnection(store)
    const updated = { ...current, ...patch }
    if (patch.customUrl !== undefined) {
      const trimmed = patch.customUrl.trim()
      const normalized = normalizeCustomUrl(trimmed)
      if (trimmed && !normalized) throw new Error('Invalid Gitea URL')
      updated.customUrl = normalized || ''
    }
    const previousEndpoint = getGiteaEndpoint(current)
    const endpoint = getGiteaEndpoint(updated)
    const changed = previousEndpoint !== endpoint
    if (!persistenceUncertain && !changed
      && updated.instanceType === current.instanceType && updated.customUrl === current.customUrl) return current
    const next = changed ? {
      ...clearIdentity(updated), revision: crypto.randomUUID(), repositoryScope: crypto.randomUUID(),
    } : updated
    await saveConnection(store, next, await store.get(connectionKey))
    return next
  })
}

export function setGiteaToken(input: string, endpoint: string, repositoryScope: string) {
  return withConnection(async store => {
    const current = await readConnection(store)
    if (getGiteaEndpoint(current) !== endpoint || current.repositoryScope !== repositoryScope) {
      throw new Error('Gitea instance changed')
    }
    const token = input.trim()
    if (!persistenceUncertain && token === current.token) return current
    const next = { ...current, token, username: '', branch: '', revision: crypto.randomUUID() }
    await saveConnection(store, next, await store.get(connectionKey))
    return next
  })
}

export function recordGiteaUsername(revision: string, username: string) {
  return withConnection(async store => {
    const current = await readConnection(store)
    if (!current.token || current.revision !== revision) throw new Error('Gitea instance or token changed')
    if (current.username === username && current.account === username) return current
    const accountChanged = Boolean(current.account && current.account !== username)
    const next = {
      ...current, username, account: username,
      revision: accountChanged ? crypto.randomUUID() : current.revision,
      branch: accountChanged ? '' : current.branch,
      repositoryScope: accountChanged ? crypto.randomUUID() : current.repositoryScope,
    }
    await saveConnection(store, next, await store.get(connectionKey))
    return next
  })
}
