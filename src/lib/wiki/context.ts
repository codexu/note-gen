import { Store } from '@tauri-apps/plugin-store'
import { getDb } from '@/db'
import { getWorkspacePath, getDefaultArticleAbsolutePath } from '@/lib/workspace'
import { getOptionalSyncRepoName, getDataSyncRepoName } from '@/lib/sync/repo-utils'
import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'
import type { WikiContext } from '@/types/wiki'
import useSettingStore from '@/stores/setting'

let workspaceRevision = 0
let observingWorkspace = false
const workspaceListeners = new Set<() => void>()

function observeWikiWorkspace() {
  if (observingWorkspace) return
  observingWorkspace = true
  useSettingStore.subscribe((state, previous) => {
    if (state.workspacePath === previous.workspacePath) return
    workspaceRevision++
    workspaceListeners.forEach(listener => listener())
  })
}

export function getWikiWorkspaceRevision(): number {
  observeWikiWorkspace()
  return workspaceRevision
}

export function subscribeWikiWorkspaceChanges(listener: () => void): () => void {
  observeWikiWorkspace()
  workspaceListeners.add(listener)
  return () => { workspaceListeners.delete(listener) }
}

/** A later return to the same path must not revive an earlier operation. */
export function captureWikiWorkspaceGuard(): () => boolean {
  const revision = getWikiWorkspaceRevision()
  const path = useSettingStore.getState().workspacePath
  return () => workspaceRevision === revision && useSettingStore.getState().workspacePath === path
}

export async function assertWikiContextCurrent(expectedContextId: string): Promise<WikiContext> {
  const isCurrent = captureWikiWorkspaceGuard()
  const context = await getWikiContext()
  if (!isCurrent() || context.id !== expectedContextId) throw new Error('WIKI_CONTEXT_CHANGED')
  return context
}

export function compareWikiKeys(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0 }

export async function wikiHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

let deviceIdentity: Promise<string> | null = null
/** Device identity is used for concurrent edits to the shared Wiki settings. */
export function getWikiDeviceId(): Promise<string> {
  if (!deviceIdentity) deviceIdentity = (async () => {
    const [store, database] = await Promise.all([Store.load('store.json'), getDb()])
    const seed = await store.get<string>('wikiDeviceId') || crypto.randomUUID()
    await database.execute('create table if not exists wiki_sync_identity(id text primary key,value text not null)')
    await database.execute("insert or ignore into wiki_sync_identity(id,value) values('device',$1)", [seed])
    const rows = await database.select<Array<{ value: string }>>("select value from wiki_sync_identity where id='device'")
    const deviceId = rows[0]?.value
    if (!deviceId) throw new Error('WIKI_SYNC_DEVICE_UNAVAILABLE')
    await store.set('wikiDeviceId', deviceId)
    await store.save()
    return deviceId
  })().catch(error => { deviceIdentity = null; throw error })
  return deviceIdentity
}

function workspaceIdentity(workspace: { path: string; isCustom: boolean }) {
  return `${workspace.isCustom ? 'custom:' : 'default:'}${workspace.path.replaceAll('\\', '/').replace(/\/+$/, '')}`
}

/** Wiki files belong to their note workspace, independent of the sync provider. */
export async function getWikiContext(): Promise<WikiContext> {
  const [store, workspace] = await Promise.all([Store.load('store.json'), getWorkspacePath()])
  const provider = await store.get<SyncPlatform>('primaryBackupMethod') || 'local'
  const workspaceKey = workspaceIdentity(workspace)
  return { id: await wikiHash(JSON.stringify(['wiki-markdown', workspaceKey])), workspaceKey, provider, remoteKey: '' }
}

/** Previous provider-bound identity, used only to recover the first Wiki version's local cache. */
export async function getLegacyWikiContextId(): Promise<string> {
  const [store, workspace] = await Promise.all([Store.load('store.json'), getWorkspacePath()])
  const provider = await store.get<SyncPlatform>('primaryBackupMethod') || 'local'
  let target: unknown = [provider]
  if (provider === 'github' || provider === 'gitee' || provider === 'gitlab' || provider === 'gitea') {
    target = [provider, await store.get<string>(`${provider}Username`) || '',
      await store.get<string>(`${provider}CustomUrl`) || '', await store.get<string>(`${provider}Branch`) || 'main',
      await getOptionalSyncRepoName(provider), await getDataSyncRepoName(provider)]
  } else if (provider === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    target = [provider, config?.endpoint, config?.bucket, config?.pathPrefix]
  } else if (provider === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    target = [provider, config?.url, config?.username, config?.pathPrefix]
  } else if (provider === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    target = [provider, config?.provider, config?.path, config?.oneDriveRootId, config?.oneDriveWorkspacePath]
  } else if (provider === 'selfHosted') {
    const localRoot = workspace.isCustom ? workspace.path : await getDefaultArticleAbsolutePath('')
    const database = await getDb()
    const bindings = await database.select<Array<{ profileId: string; workspaceId: string; workspaceType: string; instanceId: string | null }>>(
      `select b.profile_id as profileId,b.workspace_id as workspaceId,b.workspace_type as workspaceType,p.instance_id as instanceId
       from self_hosted_workspace_bindings b join self_hosted_sync_profiles p on p.id=b.profile_id and p.state='connected'
       where b.binding_state='bound' and (b.workspace_type='account-data' or (b.workspace_type='library' and b.local_root=$1))
       order by b.updated_at desc`, [localRoot])
    const profiles = await database.select<Array<{ id: string }>>(
      "select id from self_hosted_sync_profiles where state='connected' order by updated_at desc,id limit 1")
    const profile = bindings.find(binding => binding.workspaceType === 'library')?.profileId ?? profiles[0]?.id
    target = [provider, ...bindings.filter(binding => binding.profileId === profile)
      .sort((left, right) => compareWikiKeys(`${left.workspaceType}:${left.workspaceId}`, `${right.workspaceType}:${right.workspaceId}`))
      .map(binding => [binding.instanceId, binding.workspaceId, binding.workspaceType])]
  }
  return wikiHash(JSON.stringify([workspaceIdentity(workspace), target]))
}
