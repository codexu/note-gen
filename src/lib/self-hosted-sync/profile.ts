import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isOfficialSyncOrigin } from './service-source'
import { Store } from '@tauri-apps/plugin-store'
import { executeRecordTransaction, getDb } from '@/db'
import { SelfHostedApiError, SelfHostedClient, normalizeServerUrl } from './client'
import { findSelfHostedLogin, listSelfHostedLogins, rememberSelfHostedLogin } from './login-history'
import type { ClientSession } from './protocol'

export interface SelfHostedProfile {
  id: string
  serverUrl: string
  instanceId: string | null
  accountId: string | null
  deviceId: string | null
  state: 'disconnected' | 'connected' | 'pending-review' | 'inactive' | 'reauthentication-required'
  insecureHttp: boolean
  domainToggles: Record<string, boolean>
  accessExpiresAt: number | null
}

export function getSelfHostedAccountLogin(profile: Pick<SelfHostedProfile, 'serverUrl' | 'instanceId' | 'accountId'>) {
  if (!profile.accountId) return null
  return listSelfHostedLogins(profile.serverUrl, profile.instanceId ?? undefined)
    .find(account => account.accountId === profile.accountId)?.login ?? profile.accountId
}

export class SelfHostedInstanceChangedError extends Error {
  constructor(readonly serverUrl: string, readonly instanceId: string) {
    super('服务器实例身份已变化，请先确认服务器是否被重置或替换')
    this.name = 'SelfHostedInstanceChangedError'
  }
}

interface DeviceKeyPair {
  privateKey: string
  publicKey: string
}

interface DeviceIdentity {
  deviceId: string
  publicKey?: string
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
const domainToggleUpdates = new Map<string, Promise<void>>()
const invalidSessionCodes = new Set([
  'device_revoked', 'token_invalid', 'session_revoked', 'refresh_token_invalid', 'refresh_token_revoked',
  'refresh_token_reused', 'credential_epoch_invalid', 'instance_auth_epoch_invalid',
])
const DEVICE_ID_STORE_KEY = 'selfHostedDeviceId'
let loginInProgress = false

export async function connectWithPassword(input: {
  serverUrl: string
  login: string
  password: string
  totpCode?: string
  deviceName: string
  confirmedInstanceId?: string
  expectedProfile?: Pick<SelfHostedProfile, 'id' | 'accountId' | 'deviceId'>
  signal?: AbortSignal
}): Promise<SelfHostedProfile> {
  const { normalized, client: unauthenticated, capabilities } = await resolveServerConnection(input.serverUrl, input.signal)
  if (capabilities.protocol.minimum > 1 || capabilities.protocol.maximum < 1) {
    throw new Error('服务器与当前 NoteGen 同步协议不兼容')
  }

  const existing = await profileForServer(normalized.url)
  assertServerInstance(normalized.url, existing?.instanceId, capabilities.instanceId, input.confirmedInstanceId)
  input.signal?.throwIfAborted()
  return withSelfHostedLogin(async () => {
    const remembered = findSelfHostedLogin(normalized.url, capabilities.instanceId, input.login)
    const knownDevice = input.expectedProfile?.deviceId ?? (remembered && remembered.accountId !== existing?.accountId
      ? await deviceIdForAccount(normalized.url, capabilities.instanceId, remembered.accountId)
      : existing?.deviceId)
    let identity = await getOrCreateDeviceIdentity(knownDevice ?? undefined)
    input.signal?.throwIfAborted()
    let session: ClientSession
    try {
      session = await loginWithDeviceIdentity(unauthenticated, input, identity)
    } catch (error) {
      if (!isDeviceIdentityConflict(error)) throw error
      input.signal?.throwIfAborted()
      identity = { ...identity, deviceId: crypto.randomUUID() }
      session = await loginWithDeviceIdentity(unauthenticated, input, identity)
    }
    // A successful login replaces the previous refresh token for this device.
    // Keep the new session even if the connection panel closed during the POST.
    assertExpectedAccount(input.expectedProfile, session)
    const profile = await finishConnection(normalized, capabilities, session, input.expectedProfile?.id)
    rememberSelfHostedLogin(normalized.url, {
      accountId: session.accountId,
      instanceId: capabilities.instanceId,
      login: input.login,
    })
    return profile
  })
}

export interface BrowserDeviceAuthorization {
  userCode: string
  url: string
  expiresAt: number
}

export async function connectWithBrowser(input: {
  serverUrl: string
  deviceName: string
  confirmedInstanceId?: string
  expectedProfile?: Pick<SelfHostedProfile, 'id' | 'accountId' | 'deviceId'>
  signal?: AbortSignal
  onAuthorization?: (authorization: BrowserDeviceAuthorization | null) => void
}): Promise<SelfHostedProfile> {
  const { normalized, client, capabilities } = await resolveServerConnection(input.serverUrl, input.signal)
  if (capabilities.protocol.minimum > 1 || capabilities.protocol.maximum < 1) {
    throw new Error('服务器与当前 NoteGen 同步协议不兼容')
  }
  const existing = await profileForServer(normalized.url)
  assertServerInstance(normalized.url, existing?.instanceId, capabilities.instanceId, input.confirmedInstanceId)
  if (capabilities.features.deviceAuthorization === false) throw new Error('SELF_HOSTED_BROWSER_UNAVAILABLE')
  input.signal?.throwIfAborted()
  return withSelfHostedLogin(async () => {
    let identity = await getOrCreateDeviceIdentity(input.expectedProfile?.deviceId ?? existing?.deviceId ?? undefined)
    for (let identityAttempt = 0; identityAttempt < 2; identityAttempt++) {
      const authorization = await client.createDeviceAuthorization({
        deviceId: identity.deviceId,
        deviceName: input.deviceName,
        platform: platform(),
        encryptionPublicKey: identity.publicKey,
      }, input.signal)
      const deadline = Date.now() + authorization.expiresIn * 1_000
      let savingProfile = false
      try {
        if (isOfficialSyncOrigin(normalized.url)) {
          const verification = new URL(authorization.verificationUriComplete)
          if (verification.origin !== normalized.url || verification.username || verification.password
            || verification.pathname !== '/connect/') throw new Error('SELF_HOSTED_OFFICIAL_ORIGIN_MISMATCH')
        }
        input.signal?.throwIfAborted()
        input.onAuthorization?.({ userCode: authorization.userCode, url: authorization.verificationUriComplete, expiresAt: deadline })
        await openUrl(authorization.verificationUriComplete).catch(error => {
          if (!input.onAuthorization) throw error
        })
        const interval = Math.max(1, authorization.interval) * 1_000
        let pollDelay = interval
        while (Date.now() < deadline) {
          await wait(Math.min(pollDelay, deadline - Date.now()), input.signal)
          if (Date.now() >= deadline) break
          try {
            const session = await client.exchangeDeviceAuthorization(authorization.deviceCode, input.signal)
            input.signal?.throwIfAborted()
            assertExpectedAccount(input.expectedProfile, session)
            input.onAuthorization?.(null)
            savingProfile = true
            return await finishConnection(normalized, capabilities, session, input.expectedProfile?.id)
          } catch (error) {
            if (!savingProfile && error instanceof SelfHostedApiError) {
              if (error.body.code === 'authorization_pending') {
                pollDelay = interval
                continue
              }
              if (error.status === 429 || error.body.retryable) {
                const seconds = error.body.details?.retryAfterSeconds
                const milliseconds = error.body.details?.retryAfterMilliseconds
                const retryAfter = typeof seconds === 'number' ? seconds * 1_000 : milliseconds
                pollDelay = typeof retryAfter === 'number' && Number.isFinite(retryAfter)
                  ? Math.max(interval, retryAfter) : Math.min(pollDelay * 2, 30_000)
                continue
              }
            }
            throw error
          }
        }
        throw new SelfHostedApiError({ code: 'authorization_expired', message: '浏览器授权已过期', requestId: '', retryable: false }, 401)
      } catch (error) {
        void client.cancelDeviceAuthorization(authorization.deviceCode).catch(() => undefined)
        if (!savingProfile && identityAttempt === 0 && isDeviceIdentityConflict(error)) {
          identity = { ...identity, deviceId: crypto.randomUUID() }
          continue
        }
        throw error
      } finally {
        input.onAuthorization?.(null)
      }
    }
    throw new Error('无法创建新的设备身份')
  })
}

function assertExpectedAccount(profile: Pick<SelfHostedProfile, 'accountId'> | undefined, session: ClientSession) {
  if (profile?.accountId && profile.accountId !== session.accountId) {
    throw new Error('SELF_HOSTED_REAUTHENTICATION_ACCOUNT_MISMATCH')
  }
}

async function ensurePersonalWorkspace(profileId: string, client: SelfHostedClient) {
  const workspaceKey = await invoke<string>('self_hosted_generate_workspace_key')
  const encryptedName = await invoke<EncryptedPayload>('self_hosted_encrypt', {
    key: workspaceKey,
    plaintext: '个人数据',
    associatedData: 'workspace-name:v1',
  })
  const workspace = await client.ensureAccountDataWorkspace(JSON.stringify(encryptedName), workspaceKey)
  const database = await getDb()
  const existingBindings = await database.select<Array<{ profileId: string }>>(
    'select profile_id as profileId from self_hosted_workspace_bindings where workspace_id = $1 limit 1',
    [workspace.id],
  )
  if (existingBindings[0] && existingBindings[0].profileId !== profileId) throw new Error('SELF_HOSTED_WORKSPACE_PROFILE_MISMATCH')
  const keys = await client.workspaceKeys(workspace.id)
  const managedKey = keys.find(key => key.keyVersion === 1)?.envelopes
    .find(envelope => envelope.type === 'managed')?.wrappedKey
  if (!managedKey) throw new Error('个人数据空间缺少 managed key')
  const session = await client.syncSession(workspace.id, '0')
  await secureSet(workspaceSecretKey(workspace.id, 1), managedKey)
  const now = Date.now()
  await database.execute(
    `insert into self_hosted_workspace_bindings(
       workspace_id, profile_id, workspace_type, binding_state, access_mode,
       sync_epoch, created_at, updated_at
     ) values ($1, $2, 'account-data', 'bound', 'read-write', $3, $4, $4)
     on conflict(workspace_id) do update set
       sync_epoch = coalesce(self_hosted_workspace_bindings.sync_epoch, excluded.sync_epoch),
       updated_at = excluded.updated_at
       where self_hosted_workspace_bindings.profile_id = excluded.profile_id`,
    [workspace.id, profileId, session.syncEpoch, now]
  )
  await database.execute(
    `insert into self_hosted_workspace_keys(workspace_id, key_version, secure_storage_key, created_at)
     values ($1, 1, $2, $3)
     on conflict(workspace_id, key_version) do update set secure_storage_key = excluded.secure_storage_key`,
    [workspace.id, workspaceSecretKey(workspace.id, 1), now]
  )
  if (existingBindings.length === 0) await enqueueInitialPersonalData(workspace.id)
  await reconcilePersonalWorkspaceObjects(workspace.id)
  return workspace
}

async function enqueueInitialPersonalData(workspaceId: string) {
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
         workspace_id, domain, local_key, operation, reason, state, created_at, updated_at
       ) select $1, $2, ${source.key}, ${source.operation}, 'personal-initial-import', 'pending', $3, $3
         from ${source.table}`,
      [workspaceId, source.domain, now]
    )
  }
  await database.execute(
    `insert into self_hosted_local_changes(
       workspace_id, domain, local_key, operation, reason, state, created_at, updated_at
     ) values ($1, 'setting', 'all', 'upsert', 'personal-initial-import', 'pending', $2, $2)`,
    [workspaceId, now]
  )
}

export async function reconcilePersonalWorkspaceObjects(workspaceId: string) {
  const database = await getDb()
  const now = Date.now()
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
  const profiles = await database.select<Array<{ domainToggles: string }>>(`select p.domain_toggles as domainToggles
    from self_hosted_workspace_bindings b join self_hosted_sync_profiles p on p.id = b.profile_id
    where b.workspace_id = $1 limit 1`, [workspaceId])
  if (profiles[0]) {
    const { enqueuePersonalAssetBackfill } = await import('./personal-assets')
    await enqueuePersonalAssetBackfill(workspaceId, JSON.parse(profiles[0].domainToggles) as Record<string, boolean>)
  }
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
    if (authenticatedSessionLoads.get(profileId) === load) authenticatedSessions.set(profileId, session)
    return createAuthenticatedClient(profileId, session)
  } finally {
    if (authenticatedSessionLoads.get(profileId) === load) authenticatedSessionLoads.delete(profileId)
  }
}

async function loadAuthenticatedSession(profileId: string) {
  const profile = await getProfile(profileId)
  if (!profile) throw new Error('自托管同步配置不存在')
  if (profile.state !== 'connected' && profile.state !== 'pending-review') {
    console.info('[self-hosted-sync] session.reauthentication-required', { profileId, state: profile.state })
    throw new Error('自托管登录已失效，请重新授权')
  }
  let accessToken = await secureGet(secretKey(profileId, 'access-token'))
  if (!accessToken) {
    if (usesLocalSelfHostedCredentials()) throw new Error('SELF_HOSTED_SESSION_REQUIRED')
    console.warn('[self-hosted-sync] session.access-token-missing', { profileId })
    await markProfileReauthenticationRequired(profileId)
    throw new Error('自托管登录已失效，请重新授权')
  }
  if ((profile.accessExpiresAt ?? 0) <= Date.now() + 60_000) {
    console.info('[self-hosted-sync] session.refresh-started', { profileId })
    accessToken = await refreshAccessToken(profile, accessToken)
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
      async code => {
        if (invalidSessionCodes.has(code)) {
          await markProfileReauthenticationRequired(profileId, session.accessToken)
        } else if (code === 'unauthorized' && await secureGet(secretKey(profileId, 'access-token')) === session.accessToken) {
          clearAuthenticatedSession(profileId)
          await (await getDb()).execute('update self_hosted_sync_profiles set access_expires_at = 0 where id = $1', [profileId])
        }
      },
    ),
  }
}

function clearAuthenticatedSession(profileId: string) {
  authenticatedSessions.delete(profileId)
  authenticatedSessionLoads.delete(profileId)
}

export function isSelfHostedAuthenticationError(error: unknown) {
  return error instanceof SelfHostedApiError && invalidSessionCodes.has(error.body.code)
}

export async function markProfileReauthenticationRequired(profileId: string, rejectedAccessToken?: string) {
  const localCredentials = usesLocalSelfHostedCredentials()
  if (localCredentials) {
    const cleared = await invoke<boolean>('self_hosted_secure_clear_session', {
      profileId, expectedAccessToken: rejectedAccessToken,
    })
    if (!cleared) return
  } else if (rejectedAccessToken !== undefined) {
    const currentAccessToken = await secureGet(secretKey(profileId, 'access-token'))
    if (currentAccessToken !== rejectedAccessToken) {
      console.info('[self-hosted-sync] session.stale-authentication-rejection-ignored', { profileId })
      return
    }
  }
  console.warn('[self-hosted-sync] session.mark-reauthentication-required', { profileId })
  clearAuthenticatedSession(profileId)
  const wasActive = await getActiveProfileId() === profileId
  if (!localCredentials) {
    await (await getDb()).execute(
      "update self_hosted_sync_profiles set state = 'reauthentication-required', access_expires_at = null, updated_at = $1 where id = $2",
      [Date.now(), profileId]
    )
    await Promise.all([
      secureDelete(secretKey(profileId, 'access-token')).catch(() => undefined),
      secureDelete(secretKey(profileId, 'refresh-token')).catch(() => undefined),
    ])
  } else if (!await selfHostedSessionNeedsLogin(profileId)) {
    return
  }
  const { default: useSyncStore } = await import('@/stores/sync')
  if (wasActive) useSyncStore.getState().setSelfHostedConnected(false)
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

export function updateDomainToggle(profileId: string, domain: string, enabled: boolean) {
  const previous = domainToggleUpdates.get(profileId) ?? Promise.resolve()
  const update = previous.then(() => updateDomainToggleRaw(profileId, domain, enabled))
  const settled = update.then(() => undefined, () => undefined)
  domainToggleUpdates.set(profileId, settled)
  void settled.then(() => {
    if (domainToggleUpdates.get(profileId) === settled) domainToggleUpdates.delete(profileId)
  })
  return update
}

async function updateDomainToggleRaw(profileId: string, domain: string, enabled: boolean) {
  if (!Object.hasOwn(DEFAULT_DOMAIN_TOGGLES, domain)) throw new Error('不支持的个人数据同步领域')
  const profile = await getProfile(profileId)
  if (!profile || (profile.state !== 'connected' && profile.state !== 'pending-review')) {
    throw new Error('SELF_HOSTED_PREVIEW_CONNECTION_REQUIRED')
  }
  if ((profile.domainToggles[domain] !== false) === enabled) return profile.domainToggles
  if (profile.state === 'pending-review') {
    const domainToggles = { ...profile.domainToggles, [domain]: enabled }
    const now = Date.now()
    await executeRecordTransaction([
      { sql: "update self_hosted_sync_profiles set domain_toggles = $1, updated_at = $2 where id = $3 and state = 'pending-review'",
        values: [JSON.stringify(domainToggles), now, profileId], expectedRows: 1 },
      // A previously used profile can have acknowledged events under an older scope.
      { sql: `update self_hosted_workspace_bindings set binding_state = 'epoch-changed', updated_at = $1
          where profile_id = $2 and workspace_type = 'account-data'
            and binding_state in ('bound', 'bootstrapping', 'epoch-changed')`,
        values: [now, profileId] },
    ])
    clearAuthenticatedSession(profileId)
    return domainToggles
  }
  // Drain the current sender before changing policy. Once this call returns,
  // queued commands from a disabled domain cannot still be sent by that run.
  const { getSelfHostedSyncRuntime } = await import('./runtime')
  const { pauseSelfHostedCollaboration, waitForSelfHostedCollaborationIdle } = await import('./collaboration')
  // Generate the final debounced deltas while the current collaboration
  // generation still accepts them, then wait for their local persistence.
  const [{ default: canvases }, { default: articles }, { prepareActiveEditorDeactivationDurably }] = await Promise.all([
    import('@/stores/canvas'), import('@/stores/article'), import('@/lib/editor-deactivation'),
  ])
  const canvasState = canvases.getState()
  for (const [id, document] of Object.entries(canvasState.documents)) {
    const persisted = canvasState.projects.find(project => project.id === id)?.document
    if (JSON.stringify(document) !== JSON.stringify(persisted)) await canvases.getState().saveProject(id)
  }
  const article = articles.getState()
  if (!await prepareActiveEditorDeactivationDurably(article.activeFilePath)) {
    throw new Error('请先完成当前编辑，再修改同步范围')
  }
  await article.flushAllPendingArticleSaves()
  const resume = pauseSelfHostedCollaboration()
  try {
    await getSelfHostedSyncRuntime().stopAndWait()
    await waitForSelfHostedCollaborationIdle()
    const domainToggles = { ...profile.domainToggles, [domain]: enabled }
    const now = Date.now()
    await executeRecordTransaction([
      { sql: 'update self_hosted_sync_profiles set domain_toggles = $1, updated_at = $2 where id = $3',
        values: [JSON.stringify(domainToggles), now, profileId] },
      // Disabled events are intentionally acknowledged. Revisit an authoritative
      // snapshot for every policy change, including domains resumed indirectly
      // when their tag/conversation dependency is turned back on.
      { sql: `update self_hosted_workspace_bindings set binding_state = 'epoch-changed', updated_at = $1
          where profile_id = $2 and workspace_type = 'account-data'
            and binding_state in ('bound', 'bootstrapping', 'epoch-changed')`,
        values: [now, profileId] },
    ])
    clearAuthenticatedSession(profileId)
    return domainToggles
  } catch (error) {
    resume()
    const { refreshSelfHostedSyncRuntime } = await import('./lifecycle')
    await refreshSelfHostedSyncRuntime().catch(restartError => {
      console.warn('[self-hosted-sync] Unable to restart after a domain policy update failed', restartError)
    })
    throw error
  } finally { resume() }
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
  const sessionDeletes = usesLocalSelfHostedCredentials() ? [
    invoke<boolean>('self_hosted_secure_clear_session', { profileId }),
  ] : [
    secureDelete(secretKey(profileId, 'access-token')),
    secureDelete(secretKey(profileId, 'refresh-token')),
    secureDelete(secretKey(profileId, 'refresh-request-id')),
  ]
  await Promise.all([
    ...sessionDeletes,
    secureDelete(secretKey(profileId, 'device-private-key')),
    ...keys.map(key => secureDelete(key.secureStorageKey)),
  ])
  await database.execute(
    "update self_hosted_sync_profiles set state = 'disconnected', updated_at = $1 where id = $2",
    [Date.now(), profileId]
  )
  await clearConnectionReview(profileId)
}

export async function requireConnectionReview(profileId: string) {
  const store = await Store.load('store.json')
  await store.set('selfHostedConnectionReviewProfileId', profileId)
  await store.save()
}

export async function clearConnectionReview(profileId: string) {
  const store = await Store.load('store.json')
  if (await store.get<string>('selfHostedConnectionReviewProfileId') !== profileId) return
  await store.delete('selfHostedConnectionReviewProfileId')
  await store.save()
}

export function workspaceSecretKey(workspaceId: string, keyVersion: number) {
  return `workspace.${workspaceId}.key.${keyVersion}`
}

function secretKey(profileId: string, name: string) {
  return `profile.${profileId}.${name}`
}

export function usesLocalSelfHostedCredentials() {
  const os = platform()
  return os === 'macos' || os === 'ios'
}

export async function selfHostedSessionNeedsLogin(profileId: string) {
  // Keep the configured profile active for local change tracking when login is required.
  return usesLocalSelfHostedCredentials() && !await secureGet(secretKey(profileId, 'access-token'))
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

function storeLocalSession(profileId: string, session: ClientSession, expectedRefreshToken?: string) {
  return invoke<boolean>('self_hosted_secure_store_session', {
    profileId, accessToken: session.accessToken, refreshToken: session.refreshToken, expectedRefreshToken,
  })
}

export function isSelfHostedSecureStorageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('self-hosted-secure-storage-unavailable')
}

// Background preparation must never reset the native failure latch. Only
// explicit login, connection review and retry actions may request access again.
export async function retrySecureStorageAccess() {
  await invoke<void>('self_hosted_secure_retry_access')
  const { getSelfHostedSyncRuntime } = await import('./runtime')
  getSelfHostedSyncRuntime().allowSecureStorageRetry()
}

async function withSelfHostedLogin<T>(operation: () => Promise<T>) {
  if (loginInProgress) throw new Error('SELF_HOSTED_AUTHORIZATION_IN_PROGRESS')
  loginInProgress = true
  let result: T
  try {
    await invoke<void>('self_hosted_secure_retry_access')
    result = await operation()
  } finally {
    loginInProgress = false
  }
  await import('./runtime').then(({ getSelfHostedSyncRuntime }) => {
    getSelfHostedSyncRuntime().allowSecureStorageRetry()
  }).catch(() => console.warn('[self-hosted-sync] Could not resume automatic synchronization after sign-in'))
  return result
}

// Authorization prepares a candidate without changing the active engine.
async function finishConnection(
  normalized: ReturnType<typeof normalizeServerUrl>,
  capabilities: { instanceId: string },
  session: ClientSession,
  resumeProfileId?: string,
): Promise<SelfHostedProfile> {
  const database = await getDb()
  const [existing] = await database.select<Array<{ id: string; state: SelfHostedProfile['state'] }>>(
    'select id, state from self_hosted_sync_profiles where server_url = $1 and instance_id = $2 and account_id = $3',
    [normalized.url, capabilities.instanceId, session.accountId],
  )
  const store = await Store.load('store.json')
  const pendingId = await store.get<string>('selfHostedConnectionReviewProfileId')
  const [active] = await database.select<Array<{ id: string }>>(
    "select id from self_hosted_sync_profiles where state = 'connected' limit 1",
  )
  const profileId = existing?.id ?? crypto.randomUUID()
  const resumable = existing?.state === 'reauthentication-required'
    && !active && (!pendingId || resumeProfileId === profileId)
    && await store.get('primaryBackupMethod') === 'selfHosted'
    && (await database.select<Array<{ id: string }>>(
      "select workspace_id as id from self_hosted_workspace_bindings where profile_id = $1 and workspace_type = 'library' and local_root is not null limit 1",
      [profileId],
    )).length > 0
  const keepsConnection = existing?.state === 'connected' && (pendingId !== profileId || resumeProfileId === profileId)
  const state: SelfHostedProfile['state'] = keepsConnection || resumable
    ? 'connected' : 'pending-review'
  if (state === 'pending-review' && pendingId !== profileId && await store.get('platformSwitchRecovery')) {
    throw new Error('SYNC_SWITCH_INTERRUPTED')
  }
  clearAuthenticatedSession(profileId)
  const localCredentials = usesLocalSelfHostedCredentials()
  if (localCredentials) {
    await storeLocalSession(profileId, session)
  } else {
    await secureSet(secretKey(profileId, 'access-token'), session.accessToken)
    await secureSet(secretKey(profileId, 'refresh-token'), session.refreshToken)
    await secureDelete(secretKey(profileId, 'refresh-request-id'))
  }
  const now = Date.now()
  await database.execute(
    `insert into self_hosted_sync_profiles(
       id, server_url, instance_id, account_id, device_id, state, insecure_http,
       domain_toggles, access_expires_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     on conflict(id) do update set device_id = excluded.device_id, state = excluded.state,
       insecure_http = excluded.insecure_http, access_expires_at = excluded.access_expires_at,
       updated_at = excluded.updated_at`,
    [
      profileId, normalized.url, capabilities.instanceId, session.accountId, session.deviceId, state,
      normalized.insecureHttp ? 1 : 0, JSON.stringify(DEFAULT_DOMAIN_TOGGLES),
      now + session.accessTokenExpiresIn * 1_000, now,
    ]
  )
  if (state === 'pending-review' && !(localCredentials && pendingId === profileId)) {
    try {
      await ensurePersonalWorkspace(profileId, new SelfHostedClient(normalized.url, session.accessToken))
      await requireConnectionReview(profileId)
    } catch (error) {
      await disconnectProfile(profileId).catch(() => database.execute(
        "update self_hosted_sync_profiles set state = 'reauthentication-required', updated_at = $1 where id = $2 and state = 'pending-review'",
        [Date.now(), profileId],
      ).catch(() => undefined))
      throw error
    }
    if (pendingId && pendingId !== profileId && pendingId !== active?.id) {
      await disconnectProfile(pendingId).catch(error => console.warn('[self-hosted-sync] Could not clear previous pending authorization', error))
    }
  }
  return (await getProfile(profileId))!
}

export async function getConnectionReviewProfile() {
  const store = await Store.load('store.json')
  const pendingId = await store.get<string>('selfHostedConnectionReviewProfileId')
  if (pendingId) {
    const profile = await getProfile(pendingId)
    if (profile?.state === 'pending-review' || profile?.state === 'connected') return profile
    throw new Error('SELF_HOSTED_PREVIEW_CONNECTION_REQUIRED')
  }
  const activeId = await getActiveProfileId()
  return activeId ? getProfile(activeId) : null
}

export async function getActiveProfileId() {
  const [active] = await (await getDb()).select<Array<{ id: string }>>(
    "select id from self_hosted_sync_profiles where state = 'connected' order by updated_at desc limit 1",
  )
  return active?.id ?? null
}

export async function activateReviewedProfile(profileId: string) {
  const profile = await getProfile(profileId)
  if (!profile || (profile.state !== 'pending-review' && profile.state !== 'connected')) {
    throw new Error('SELF_HOSTED_PREVIEW_CONNECTION_REQUIRED')
  }
  if (profile.state === 'connected') return
  // No background engine is running during this transaction or its rollback.
  await executeRecordTransaction([
    {
      sql: `update self_hosted_local_changes set workspace_id = (
         select b.workspace_id from self_hosted_workspace_bindings b
         join self_hosted_sync_profiles p on p.id = b.profile_id
         where b.workspace_type = 'account-data' and p.state = 'connected' limit 1
       ) where workspace_id is null and state in ('pending', 'queued')`,
      values: [],
    },
    { sql: "update self_hosted_sync_profiles set state = 'inactive' where state = 'connected' and id <> $1", values: [profileId] },
    { sql: "update self_hosted_sync_profiles set state = 'connected' where id = $1 and state = 'pending-review'", values: [profileId] },
  ])
  clearAuthenticatedSession(profileId)
}

export async function restoreReviewedProfile(profileId: string, previousId: string | null) {
  if (profileId === previousId) return
  await executeRecordTransaction([
    { sql: "update self_hosted_sync_profiles set state = 'pending-review' where id = $1 and state = 'connected'", values: [profileId] },
    ...(previousId ? [{ sql: "update self_hosted_sync_profiles set state = 'connected' where id = $1 and state = 'inactive'", values: [previousId] }] : []),
  ])
  clearAuthenticatedSession(profileId)
}

async function refreshAccessToken(profile: SelfHostedProfile, previousAccessToken: string) {
  const running = tokenRefreshes.get(profile.id)
  if (running) return running
  const localCredentials = usesLocalSelfHostedCredentials()
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
      if (localCredentials) {
        if (!await storeLocalSession(profile.id, session, refreshToken)) {
          const current = await secureGet(secretKey(profile.id, 'access-token'))
          if (current) return current
          throw new Error('SELF_HOSTED_SESSION_REQUIRED')
        }
      } else {
        await Promise.all([
          secureSet(secretKey(profile.id, 'access-token'), session.accessToken),
          secureSet(secretKey(profile.id, 'refresh-token'), session.refreshToken),
        ])
      }
      const database = await getDb()
      await database.execute(
        `update self_hosted_sync_profiles set access_expires_at = $1,
           updated_at = $2 where id = $3 and state in ('connected', 'pending-review')`,
        [Date.now() + session.accessTokenExpiresIn * 1_000, Date.now(), profile.id]
      )
      if (!localCredentials) await secureDelete(refreshRequestKey)
      return session.accessToken
    } catch (error) {
      console.warn('[self-hosted-sync] session.refresh-failed', { profileId: profile.id, error })
      if (isSelfHostedAuthenticationError(error)) {
        await markProfileReauthenticationRequired(profile.id, previousAccessToken)
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

async function getOrCreateDeviceIdentity(preferredDeviceId: string | undefined): Promise<DeviceIdentity> {
  const store = await Store.load('store.json')
  const persistedDeviceId = await store.get<string>(DEVICE_ID_STORE_KEY)
  if (usesLocalSelfHostedCredentials()) {
    // Managed workspace keys are retrieved from the server after sign-in.
    const deviceId = preferredDeviceId || persistedDeviceId || crypto.randomUUID()
    if (persistedDeviceId !== deviceId) {
      await store.set(DEVICE_ID_STORE_KEY, deviceId)
      await store.save()
    }
    return { deviceId }
  }

  const privateKey = await secureGet('device.identity.private-key')
  const publicKey = await secureGet('device.identity.public-key')
  const deviceId = preferredDeviceId || persistedDeviceId
    || await secureGet('device.identity.id') || crypto.randomUUID()

  if (!privateKey || !publicKey) {
    const generated = await invoke<DeviceKeyPair>('self_hosted_generate_device_key_pair')
    await secureSet('device.identity.private-key', generated.privateKey)
    await secureSet('device.identity.public-key', generated.publicKey)
    await secureSet('device.identity.id', deviceId)
    await store.set(DEVICE_ID_STORE_KEY, deviceId)
    await store.save()
    return { publicKey: generated.publicKey, deviceId }
  }
  if (persistedDeviceId !== deviceId) {
    await secureSet('device.identity.id', deviceId)
    await store.set(DEVICE_ID_STORE_KEY, deviceId)
    await store.save()
  }
  return { publicKey, deviceId }
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

function isDeviceIdentityConflict(error: unknown) {
  const code = apiErrorCode(error)
  return code === 'device_key_conflict' || code === 'device_conflict'
}

export async function resolveServerConnection(value: string, signal?: AbortSignal) {
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
      const capabilities = await client.capabilities(signal)
      if (capabilities.service !== 'note-gen-server') throw new Error('该地址不是自托管同步 API')
      if (isOfficialSyncOrigin(normalized.url) && capabilities.publicBaseUrl !== normalized.url) {
        throw new Error('SELF_HOSTED_OFFICIAL_ORIGIN_MISMATCH')
      }
      return { normalized, client, capabilities }
    } catch (error) {
      signal?.throwIfAborted()
      lastError = error
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('无法连接自托管同步 API')
}

async function profileForServer(serverUrl: string) {
  const store = await Store.load('store.json')
  const pendingProfileId = await store.get<string>('selfHostedConnectionReviewProfileId')
  const database = await getDb()
  const rows = await database.select<Array<{
    id: string
    instanceId: string | null
    accountId: string | null
    deviceId: string | null
  }>>(
    `select id, instance_id as instanceId, account_id as accountId, device_id as deviceId
     from self_hosted_sync_profiles
     where server_url = $1 order by id = $2 desc, state = 'connected' desc, updated_at desc limit 1`,
    [serverUrl, pendingProfileId ?? '']
  )
  return rows[0] ?? null
}

async function deviceIdForAccount(serverUrl: string, instanceId: string, accountId: string) {
  const [profile] = await (await getDb()).select<Array<{ deviceId: string | null }>>(
    'select device_id as deviceId from self_hosted_sync_profiles where server_url = $1 and instance_id = $2 and account_id = $3',
    [serverUrl, instanceId, accountId],
  )
  return profile?.deviceId
}

function assertServerInstance(serverUrl: string, previousInstanceId: string | null | undefined, instanceId: string, confirmedInstanceId?: string) {
  if ((confirmedInstanceId && confirmedInstanceId !== instanceId)
    || (previousInstanceId && previousInstanceId !== instanceId && confirmedInstanceId !== instanceId)) {
    throw new SelfHostedInstanceChangedError(serverUrl, instanceId)
  }
}

function wait(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }, milliseconds)
    function cancel() {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}
