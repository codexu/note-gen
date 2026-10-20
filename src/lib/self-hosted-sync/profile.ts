import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Store } from '@tauri-apps/plugin-store'
import { getDb } from '@/db'
import { SelfHostedApiError, SelfHostedClient, normalizeServerUrl } from './client'
import type { ClientSession } from './protocol'

export interface SelfHostedProfile {
  id: string
  serverUrl: string
  instanceId: string | null
  accountId: string | null
  deviceId: string | null
  state: 'disconnected' | 'connected' | 'reauthentication-required'
  insecureHttp: boolean
  domainToggles: Record<string, boolean>
  accessExpiresAt: number | null
}

interface DeviceKeyPair {
  privateKey: string
  publicKey: string
}

interface DeviceIdentity extends DeviceKeyPair {
  deviceId: string
}

interface EncryptedPayload {
  nonce: string
  ciphertext: string
  ciphertextHash: string
}

const DEFAULT_DOMAIN_TOGGLES = {
  tags: true,
  marks: true,
  conversations: true,
  messages: true,
  memories: true,
  settings: true,
  attachments: true,
} as const
const tokenRefreshes = new Map<string, Promise<string>>()
const authenticatedSessions = new Map<string, { profile: SelfHostedProfile; accessToken: string }>()
const authenticatedSessionLoads = new Map<string, Promise<{ profile: SelfHostedProfile; accessToken: string }>>()
const DEVICE_ID_STORE_KEY = 'selfHostedDeviceId'
let deviceIdentityLoad: Promise<DeviceIdentity> | null = null

export async function connectWithPassword(input: {
  serverUrl: string
  login: string
  password: string
  totpCode?: string
  deviceName: string
}): Promise<SelfHostedProfile> {
  const { normalized, client: unauthenticated, capabilities } = await resolveServerConnection(input.serverUrl)
  if (capabilities.protocol.minimum > 1 || capabilities.protocol.maximum < 1) {
    throw new Error('服务器与当前 NoteGen 同步协议不兼容')
  }

  const existing = await profileForServer(normalized.url)
  if (existing?.instanceId && existing.instanceId !== capabilities.instanceId) {
    throw new Error('服务器实例身份已变化，请先确认服务器是否被重置或替换')
  }
  const profileId = existing?.id ?? crypto.randomUUID()
  let keyPair = await getOrCreateDeviceIdentity(existing?.deviceId ?? undefined)
  let session: ClientSession
  try {
    session = await loginWithDeviceIdentity(unauthenticated, input, keyPair)
  } catch (error) {
    if (!isDeviceKeyConflict(error)) throw error
    keyPair = await rotateDeviceIdentity(keyPair.deviceId)
    session = await loginWithDeviceIdentity(unauthenticated, input, keyPair)
  }
  await prepareProfileAccount(profileId, existing?.accountId ?? null, session.accountId)

  await Promise.all([
    secureSet(secretKey(profileId, 'access-token'), session.accessToken),
    secureSet(secretKey(profileId, 'refresh-token'), session.refreshToken),
    secureDelete(secretKey(profileId, 'refresh-request-id')).catch(() => undefined),
  ])

  const database = await getDb()
  const now = Date.now()
  await database.execute(
    `insert into self_hosted_sync_profiles(
       id, server_url, instance_id, account_id, device_id, state, insecure_http,
       domain_toggles, access_expires_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'connected', $6, $7, $8, $9, $9)
     on conflict(id) do update set instance_id = excluded.instance_id,
       account_id = excluded.account_id, device_id = excluded.device_id, state = 'connected',
       insecure_http = excluded.insecure_http, access_expires_at = excluded.access_expires_at,
       updated_at = excluded.updated_at`,
    [
      profileId, normalized.url, capabilities.instanceId, session.accountId, session.deviceId,
      normalized.insecureHttp ? 1 : 0, JSON.stringify(DEFAULT_DOMAIN_TOGGLES),
      now + session.accessTokenExpiresIn * 1_000, now,
    ]
  )
  clearAuthenticatedSession(profileId)

  try {
    await ensurePersonalWorkspace(profileId)
    await disconnectOtherProfiles(profileId)
  } catch (error) {
    await disconnectProfile(profileId).catch(() => undefined)
    throw error
  }
  return (await getProfile(profileId))!
}

export async function connectWithBrowser(input: {
  serverUrl: string
  deviceName: string
}): Promise<SelfHostedProfile> {
  const { normalized, client, capabilities } = await resolveServerConnection(input.serverUrl)
  if (capabilities.protocol.minimum > 1 || capabilities.protocol.maximum < 1) {
    throw new Error('服务器与当前 NoteGen 同步协议不兼容')
  }
  const existing = await profileForServer(normalized.url)
  if (existing?.instanceId && existing.instanceId !== capabilities.instanceId) {
    throw new Error('服务器实例身份已变化，请先确认服务器是否被重置或替换')
  }
  const profileId = existing?.id ?? crypto.randomUUID()
  let keyPair = await getOrCreateDeviceIdentity(existing?.deviceId ?? undefined)
  for (let identityAttempt = 0; identityAttempt < 2; identityAttempt++) {
    const authorization = await client.createDeviceAuthorization({
      deviceId: keyPair.deviceId,
      deviceName: input.deviceName,
      platform: platform(),
      encryptionPublicKey: keyPair.publicKey,
    })
    await openUrl(authorization.verificationUriComplete)
    const deadline = Date.now() + authorization.expiresIn * 1_000
    try {
      while (Date.now() < deadline) {
        await wait(authorization.interval * 1_000)
        try {
          const session = await client.exchangeDeviceAuthorization(authorization.deviceCode)
          await prepareProfileAccount(profileId, existing?.accountId ?? null, session.accountId)
          await persistConnectedProfile({
            profileId,
            normalized,
            capabilities,
            session,
          })
          await ensurePersonalWorkspace(profileId)
          await disconnectOtherProfiles(profileId)
          return (await getProfile(profileId))!
        } catch (error) {
          if (apiErrorCode(error) === 'authorization_pending') continue
          throw error
        }
      }
      throw new Error('浏览器授权已过期')
    } catch (error) {
      await client.cancelDeviceAuthorization(authorization.deviceCode).catch(() => undefined)
      if (identityAttempt === 0 && isDeviceKeyConflict(error)) {
        keyPair = await rotateDeviceIdentity(keyPair.deviceId)
        continue
      }
      await disconnectProfile(profileId).catch(() => undefined)
      throw error
    }
  }
  throw new Error('无法创建新的设备身份')
}

export async function ensurePersonalWorkspace(profileId: string) {
  const { profile, client } = await authenticatedClient(profileId)
  const workspaceKey = await invoke<string>('self_hosted_generate_workspace_key')
  const encryptedName = await invoke<EncryptedPayload>('self_hosted_encrypt', {
    key: workspaceKey,
    plaintext: '个人数据',
    associatedData: 'workspace-name:v1',
  })
  const workspace = await client.ensureAccountDataWorkspace(JSON.stringify(encryptedName), workspaceKey)
  const keys = await client.workspaceKeys(workspace.id)
  const managedKey = keys.find(key => key.keyVersion === 1)?.envelopes
    .find(envelope => envelope.type === 'managed')?.wrappedKey
  if (!managedKey) throw new Error('个人数据空间缺少 managed key')
  const session = await client.syncSession(workspace.id, '0')
  await secureSet(workspaceSecretKey(workspace.id, 1), managedKey)
  const now = Date.now()
  const database = await getDb()
  const existingBindings = await database.select<Array<{ workspaceId: string }>>(
    'select workspace_id as workspaceId from self_hosted_workspace_bindings where workspace_id = $1 limit 1',
    [workspace.id]
  )
  await database.execute(
    `insert into self_hosted_workspace_bindings(
       workspace_id, profile_id, workspace_type, binding_state, access_mode,
       sync_epoch, created_at, updated_at
     ) values ($1, $2, 'account-data', 'bound', 'read-write', $3, $4, $4)
     on conflict(workspace_id) do update set
       profile_id = excluded.profile_id, sync_epoch = excluded.sync_epoch,
       binding_state = 'bound', updated_at = excluded.updated_at`,
    [workspace.id, profile.id, session.syncEpoch, now]
  )
  await database.execute(
    `insert into self_hosted_workspace_keys(workspace_id, key_version, secure_storage_key, created_at)
     values ($1, 1, $2, $3)
     on conflict(workspace_id, key_version) do update set secure_storage_key = excluded.secure_storage_key`,
    [workspace.id, workspaceSecretKey(workspace.id, 1), now]
  )
  if (existingBindings.length === 0) await enqueueInitialPersonalData()
  await reconcilePersonalWorkspaceObjects(workspace.id)
  return workspace
}

async function enqueueInitialPersonalData() {
  const database = await getDb()
  const now = Date.now()
  for (const source of [
    { table: 'tags', domain: 'tag', key: 'cast(id as text)', operation: "'upsert'" },
    { table: 'marks', domain: 'mark', key: 'coalesce(sourceId, cast(id as text))', operation: "case when deleted = 1 then 'delete' else 'upsert' end" },
    { table: 'conversations', domain: 'conversation', key: 'coalesce(syncId, cast(id as text))', operation: "'upsert'" },
    { table: 'chats', domain: 'message', key: 'coalesce(syncId, cast(id as text))', operation: "'upsert'" },
    { table: 'memories', domain: 'memory', key: 'id', operation: "'upsert'" },
    { table: 'canvases', domain: 'canvas', key: 'id', operation: "case when deletedAt is not null then 'delete' else 'upsert' end" },
  ]) {
    await database.execute(
      `insert into self_hosted_local_changes(
         domain, local_key, operation, reason, state, created_at, updated_at
       ) select $1, ${source.key}, ${source.operation}, 'personal-initial-import', 'pending', $2, $2
         from ${source.table}`,
      [source.domain, now]
    )
  }
  await database.execute(
    `insert into self_hosted_local_changes(
       domain, local_key, operation, reason, state, created_at, updated_at
     ) values ('setting', 'all', 'upsert', 'personal-initial-import', 'pending', $1, $1)`,
    [now]
  )
}

export async function reconcilePersonalWorkspaceObjects(workspaceId: string) {
  const database = await getDb()
  const now = Date.now()
  await database.execute(
    `delete from self_hosted_outbox
     where workspace_id <> $1 and state in ('pending', 'retry', 'blocked', 'failed')
       and json_extract(payload, '$.kind') = 'canvas'`,
    [workspaceId]
  )
  await database.execute(
    `update self_hosted_local_changes
     set state = 'superseded', updated_at = $1
     where domain = 'canvas' and workspace_id is not null and workspace_id <> $2
       and state in ('pending', 'queued')`,
    [now, workspaceId]
  )
  await database.execute(
    `insert into self_hosted_local_changes(
       workspace_id, domain, local_key, operation, reason, state, created_at, updated_at
     )
     select $1, 'canvas', c.id,
       case when c.deletedAt is not null then 'delete' else 'upsert' end,
       'canvas:personal-workspace-reconciliation',
       'pending', $2, $2
     from canvases c
     left join self_hosted_object_mappings m
       on m.workspace_id = $1 and m.kind = 'canvas'
       and m.local_identity = 'canvas:' || c.id
     where (
       m.object_id is null
       or (c.deletedAt is not null and m.deleted_at is null)
       or (c.deletedAt is null and m.deleted_at is not null)
     ) and not exists (
       select 1 from self_hosted_local_changes pending
       where pending.domain = 'canvas' and pending.local_key = c.id
         and (pending.workspace_id = $1 or pending.workspace_id is null)
         and pending.state in ('pending', 'queued')
     )`,
    [workspaceId, now]
  )
  await database.execute(
    `insert into self_hosted_local_changes(
       workspace_id, domain, local_key, operation, reason, state, created_at, updated_at
     )
     select $1, 'mark', coalesce(m.sourceId, cast(m.id as text)), 'delete',
       'mark:personal-workspace-reconciliation', 'pending', $2, $2
     from marks m
     join self_hosted_object_mappings mapping
       on mapping.workspace_id = $1 and mapping.kind = 'mark'
       and mapping.local_identity = 'mark:' || coalesce(m.sourceId, cast(m.id as text))
     where m.deleted = 1 and mapping.deleted_at is null
       and not exists (
         select 1 from self_hosted_local_changes pending
         where pending.domain = 'mark'
           and pending.local_key = coalesce(m.sourceId, cast(m.id as text))
           and (pending.workspace_id = $1 or pending.workspace_id is null)
           and pending.state in ('pending', 'queued')
       )`,
    [workspaceId, now]
  )
}

export async function authenticatedClient(profileId: string) {
  const cached = authenticatedSessions.get(profileId)
  if (cached && (cached.profile.accessExpiresAt ?? 0) > Date.now() + 60_000) {
    return createAuthenticatedClient(profileId, cached)
  }
  const running = authenticatedSessionLoads.get(profileId)
  if (running) return createAuthenticatedClient(profileId, await running)
  const load = loadAuthenticatedSession(profileId)
  authenticatedSessionLoads.set(profileId, load)
  try {
    const session = await load
    authenticatedSessions.set(profileId, session)
    return createAuthenticatedClient(profileId, session)
  } finally {
    authenticatedSessionLoads.delete(profileId)
  }
}

async function loadAuthenticatedSession(profileId: string) {
  const profile = await getProfile(profileId)
  if (!profile) throw new Error('自托管同步配置不存在')
  if (profile.state !== 'connected') {
    console.info('[self-hosted-sync] session.reauthentication-required', { profileId, state: profile.state })
    throw new Error('自托管登录已失效，请重新授权')
  }
  let accessToken = await secureGet(secretKey(profileId, 'access-token'))
  if (!accessToken) {
    console.warn('[self-hosted-sync] session.access-token-missing', { profileId })
    await markProfileReauthenticationRequired(profileId)
    throw new Error('自托管登录已失效，请重新授权')
  }
  if ((profile.accessExpiresAt ?? 0) <= Date.now() + 60_000) {
    console.info('[self-hosted-sync] session.refresh-started', { profileId })
    accessToken = await refreshAccessToken(profile)
    console.info('[self-hosted-sync] session.refresh-completed', { profileId })
    const refreshedProfile = await getProfile(profileId)
    if (refreshedProfile) return { profile: refreshedProfile, accessToken }
  }
  return { profile, accessToken }
}

function createAuthenticatedClient(
  profileId: string,
  session: { profile: SelfHostedProfile; accessToken: string },
) {
  return {
    ...session,
    client: new SelfHostedClient(
      session.profile.serverUrl,
      session.accessToken,
      () => markProfileReauthenticationRequired(profileId, session.accessToken),
    ),
  }
}

function clearAuthenticatedSession(profileId: string) {
  authenticatedSessions.delete(profileId)
  authenticatedSessionLoads.delete(profileId)
}

export function isSelfHostedAuthenticationError(error: unknown) {
  return error instanceof SelfHostedApiError && (
    error.status === 401 || ['device_revoked', 'token_invalid', 'session_revoked'].includes(error.body.code)
  )
}

export async function markProfileReauthenticationRequired(profileId: string, rejectedAccessToken?: string) {
  if (rejectedAccessToken !== undefined) {
    const currentAccessToken = await secureGet(secretKey(profileId, 'access-token'))
    if (currentAccessToken !== rejectedAccessToken) {
      console.info('[self-hosted-sync] session.stale-authentication-rejection-ignored', { profileId })
      return
    }
  }
  console.warn('[self-hosted-sync] session.mark-reauthentication-required', { profileId })
  clearAuthenticatedSession(profileId)
  const database = await getDb()
  await database.execute(
    "update self_hosted_sync_profiles set state = 'reauthentication-required', access_expires_at = null, updated_at = $1 where id = $2",
    [Date.now(), profileId]
  )
  await Promise.all([
    secureDelete(secretKey(profileId, 'access-token')).catch(() => undefined),
    secureDelete(secretKey(profileId, 'refresh-token')).catch(() => undefined),
  ])
  const { default: useSyncStore } = await import('@/stores/sync')
  useSyncStore.getState().setSelfHostedConnected(false)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('self-hosted-profile-state-changed', {
      detail: { profileId, state: 'reauthentication-required' },
    }))
  }
}

export async function getProfile(profileId: string): Promise<SelfHostedProfile | null> {
  const database = await getDb()
  const rows = await database.select<Array<{
    id: string; serverUrl: string; instanceId: string | null; accountId: string | null
    deviceId: string | null; state: SelfHostedProfile['state']; insecureHttp: number; domainToggles: string
    accessExpiresAt: number | null
  }>>(
    `select id, server_url as serverUrl, instance_id as instanceId, account_id as accountId,
       device_id as deviceId, state, insecure_http as insecureHttp, domain_toggles as domainToggles,
       access_expires_at as accessExpiresAt
     from self_hosted_sync_profiles where id = $1 limit 1`,
    [profileId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    ...row,
    insecureHttp: row.insecureHttp === 1,
    domainToggles: JSON.parse(row.domainToggles) as Record<string, boolean>,
  }
}

export async function updateDomainToggle(profileId: string, domain: string, enabled: boolean) {
  const profile = await getProfile(profileId)
  if (!profile) throw new Error('自托管同步配置不存在')
  const domainToggles = { ...profile.domainToggles, [domain]: enabled }
  const database = await getDb()
  await database.execute(
    'update self_hosted_sync_profiles set domain_toggles = $1, updated_at = $2 where id = $3',
    [JSON.stringify(domainToggles), Date.now(), profileId]
  )
  return domainToggles
}

export async function disconnectProfile(profileId: string) {
  clearAuthenticatedSession(profileId)
  const database = await getDb()
  const keys = await database.select<Array<{ secureStorageKey: string }>>(
    `select k.secure_storage_key as secureStorageKey
     from self_hosted_workspace_keys k
     join self_hosted_workspace_bindings b on b.workspace_id = k.workspace_id
     where b.profile_id = $1`,
    [profileId]
  )
  await Promise.all([
    secureDelete(secretKey(profileId, 'access-token')),
    secureDelete(secretKey(profileId, 'refresh-token')),
    secureDelete(secretKey(profileId, 'refresh-request-id')),
    secureDelete(secretKey(profileId, 'device-private-key')),
    ...keys.map(key => secureDelete(key.secureStorageKey)),
  ])
  await database.execute(
    "update self_hosted_sync_profiles set state = 'disconnected', updated_at = $1 where id = $2",
    [Date.now(), profileId]
  )
}

export function workspaceSecretKey(workspaceId: string, keyVersion: number) {
  return `workspace.${workspaceId}.key.${keyVersion}`
}

function secretKey(profileId: string, name: string) {
  return `profile.${profileId}.${name}`
}

export function secureSet(key: string, value: string) {
  return invoke<void>('self_hosted_secure_set', { key, value })
}

export function secureGet(key: string) {
  return invoke<string | null>('self_hosted_secure_get', { key })
}

export function secureDelete(key: string) {
  return invoke<void>('self_hosted_secure_delete', { key })
}

async function persistConnectedProfile(input: {
  profileId: string
  normalized: ReturnType<typeof normalizeServerUrl>
  capabilities: { instanceId: string }
  session: ClientSession
}) {
  await Promise.all([
    secureSet(secretKey(input.profileId, 'access-token'), input.session.accessToken),
    secureSet(secretKey(input.profileId, 'refresh-token'), input.session.refreshToken),
    secureDelete(secretKey(input.profileId, 'refresh-request-id')).catch(() => undefined),
  ])
  const database = await getDb()
  const now = Date.now()
  await database.execute(
    `insert into self_hosted_sync_profiles(
       id, server_url, instance_id, account_id, device_id, state, insecure_http,
       domain_toggles, access_expires_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'connected', $6, $7, $8, $9, $9)
     on conflict(id) do update set instance_id = excluded.instance_id,
       account_id = excluded.account_id, device_id = excluded.device_id, state = 'connected',
       insecure_http = excluded.insecure_http, access_expires_at = excluded.access_expires_at,
       updated_at = excluded.updated_at`,
    [
      input.profileId, input.normalized.url, input.capabilities.instanceId,
      input.session.accountId, input.session.deviceId,
      input.normalized.insecureHttp ? 1 : 0, JSON.stringify(DEFAULT_DOMAIN_TOGGLES),
      now + input.session.accessTokenExpiresIn * 1_000, now,
    ]
  )
  clearAuthenticatedSession(input.profileId)
}

async function refreshAccessToken(profile: SelfHostedProfile) {
  const running = tokenRefreshes.get(profile.id)
  if (running) return running
  const refresh = (async () => {
    try {
      const refreshToken = await secureGet(secretKey(profile.id, 'refresh-token'))
      if (!refreshToken || !profile.deviceId) throw new Error('自托管刷新凭据已失效')
      const refreshRequestKey = secretKey(profile.id, 'refresh-request-id')
      let refreshRequestId = await secureGet(refreshRequestKey)
      if (!refreshRequestId) {
        refreshRequestId = crypto.randomUUID()
        await secureSet(refreshRequestKey, refreshRequestId)
      }
      const session = await new SelfHostedClient(profile.serverUrl).refresh(
        refreshToken,
        profile.deviceId,
        refreshRequestId,
      )
      if (session.accountId !== profile.accountId || session.deviceId !== profile.deviceId) {
        throw new Error('刷新会话返回了不同的账号或设备')
      }
      await Promise.all([
        secureSet(secretKey(profile.id, 'access-token'), session.accessToken),
        secureSet(secretKey(profile.id, 'refresh-token'), session.refreshToken),
      ])
      const database = await getDb()
      await database.execute(
        `update self_hosted_sync_profiles set access_expires_at = $1,
           state = 'connected', updated_at = $2 where id = $3`,
        [Date.now() + session.accessTokenExpiresIn * 1_000, Date.now(), profile.id]
      )
      await secureDelete(refreshRequestKey)
      return session.accessToken
    } catch (error) {
      console.warn('[self-hosted-sync] session.refresh-failed', { profileId: profile.id, error })
      if (isSelfHostedAuthenticationError(error)) {
        await markProfileReauthenticationRequired(profile.id)
      }
      throw error
    }
  })()
  tokenRefreshes.set(profile.id, refresh)
  try {
    return await refresh
  } finally {
    tokenRefreshes.delete(profile.id)
  }
}

async function getOrCreateDeviceIdentity(preferredDeviceId?: string): Promise<DeviceIdentity> {
  if (deviceIdentityLoad) return deviceIdentityLoad
  deviceIdentityLoad = loadOrCreateDeviceIdentity(preferredDeviceId)
  try {
    return await deviceIdentityLoad
  } finally {
    deviceIdentityLoad = null
  }
}

async function loadOrCreateDeviceIdentity(preferredDeviceId?: string): Promise<DeviceIdentity> {
  const store = await Store.load('store.json')
  const [privateKey, publicKey, secureDeviceId, persistedDeviceId] = await Promise.all([
    secureGet('device.identity.private-key'),
    secureGet('device.identity.public-key'),
    secureGet('device.identity.id'),
    store.get<string>(DEVICE_ID_STORE_KEY),
  ])
  const deviceId = preferredDeviceId || persistedDeviceId || secureDeviceId || crypto.randomUUID()
  if (persistedDeviceId !== deviceId) {
    await store.set(DEVICE_ID_STORE_KEY, deviceId)
    await store.save()
  }
  if (secureDeviceId !== deviceId) await secureSet('device.identity.id', deviceId)
  if (privateKey && publicKey) return { privateKey, publicKey, deviceId }
  return rotateDeviceIdentity(deviceId)
}

async function rotateDeviceIdentity(deviceId: string): Promise<DeviceIdentity> {
  const generated = await invoke<DeviceKeyPair>('self_hosted_generate_device_key_pair')
  const store = await Store.load('store.json')
  await Promise.all([
    secureSet('device.identity.private-key', generated.privateKey),
    secureSet('device.identity.public-key', generated.publicKey),
    secureSet('device.identity.id', deviceId),
    store.set(DEVICE_ID_STORE_KEY, deviceId),
  ])
  await store.save()
  return { ...generated, deviceId }
}

function loginWithDeviceIdentity(
  client: SelfHostedClient,
  input: { login: string; password: string; totpCode?: string; deviceName: string },
  identity: DeviceIdentity,
) {
  return client.login({
    login: input.login,
    password: input.password,
    ...(input.totpCode ? { totpCode: input.totpCode } : {}),
    deviceId: identity.deviceId,
    deviceName: input.deviceName,
    platform: platform(),
    encryptionPublicKey: identity.publicKey,
  })
}

function apiErrorCode(error: unknown) {
  return error instanceof Error && 'body' in error
    ? (error as { body?: { code?: string } }).body?.code
    : undefined
}

function isDeviceKeyConflict(error: unknown) {
  return apiErrorCode(error) === 'device_key_conflict'
}

async function resolveServerConnection(value: string) {
  const entered = normalizeServerUrl(value)
  const candidates = [entered]
  const enteredUrl = new URL(entered.url)
  if (entered.local && enteredUrl.port === '3790') {
    enteredUrl.port = '3789'
    candidates.push(normalizeServerUrl(enteredUrl.toString()))
  }
  let lastError: unknown
  for (const normalized of candidates) {
    const client = new SelfHostedClient(normalized.url)
    try {
      const capabilities = await client.capabilities()
      if (capabilities.service !== 'note-gen-server') throw new Error('该地址不是自托管同步 API')
      return { normalized, client, capabilities }
    } catch (error) {
      lastError = error
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('无法连接自托管同步 API')
}

async function profileForServer(serverUrl: string) {
  const database = await getDb()
  const rows = await database.select<Array<{
    id: string
    instanceId: string | null
    accountId: string | null
    deviceId: string | null
  }>>(
    `select id, instance_id as instanceId, account_id as accountId, device_id as deviceId
     from self_hosted_sync_profiles
     where server_url = $1 limit 1`,
    [serverUrl]
  )
  return rows[0] ?? null
}

async function prepareProfileAccount(profileId: string, previousAccountId: string | null, nextAccountId: string) {
  if (!previousAccountId || previousAccountId === nextAccountId) return
  const database = await getDb()
  const keys = await database.select<Array<{ secureStorageKey: string }>>(
    `select k.secure_storage_key as secureStorageKey from self_hosted_workspace_keys k
     join self_hosted_workspace_bindings b on b.workspace_id = k.workspace_id
     where b.profile_id = $1`,
    [profileId]
  )
  await Promise.all(keys.map(key => secureDelete(key.secureStorageKey)))
  await database.execute(
    `update self_hosted_workspace_bindings set binding_state = 'account-changed',
       access_mode = 'read-only', updated_at = $1 where profile_id = $2`,
    [Date.now(), profileId]
  )
  await database.execute(
    `delete from self_hosted_workspace_keys where workspace_id in (
       select workspace_id from self_hosted_workspace_bindings where profile_id = $1
     )`,
    [profileId]
  )
}

async function disconnectOtherProfiles(activeProfileId: string) {
  const database = await getDb()
  const rows = await database.select<Array<{ id: string }>>(
    `select id from self_hosted_sync_profiles where id <> $1 and state = 'connected'`,
    [activeProfileId]
  )
  await Promise.all(rows.map(profile => disconnectProfile(profile.id)))
}

function wait(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}
