import { exists, lstat } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import emitter from '@/lib/emitter'
import { getFilePathOptions } from '@/lib/workspace'
import type { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'
import { getPathMoveConfiguration, type PathMoveProvider } from './path-move-configuration'
import { moveGitPlatformPath, isGitPlatformPathSnapshot } from './git-platform-path-move'
import { s3MovePath, type S3PathIdentity } from './s3'
import { moveCloudFolderPath } from './cloud-folder-path-move'
import type { Proxy } from '@tauri-apps/plugin-http'
import { webdavMovePath, type WebDAVPathIdentity } from './webdav'
import { syncStaleError } from './sync-stale-error'
import { moveGithubPath, type GitPathEntry } from './github-path-migration-commit'
import {
  applyPathMoveMetadata,
  capturePathMoveMetadata,
  type PathMoveMetadata,
  rebindPathMoveMetadata,
} from './path-move-metadata'

interface PathMove {
  id: string
  source: string
  target: string
  ready: boolean
  metadata: PathMoveMetadata
  expected?: unknown
}

interface MoveContext {
  key: string
  provider: PathMoveProvider
  journalName: string
  webdav?: WebDAVConfig
  s3?: S3Config
  cloudFolder?: CloudFolderConfig
  proxy?: Proxy
}

let pending: Promise<unknown> = Promise.resolve()

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation)
  pending = result.catch(() => undefined)
  return result
}

function isWorkspacePath(path: string): boolean {
  return Boolean(path) && !path.includes('\\') && !/^[a-z]:/i.test(path)
    && path.split('/').every(part => part && !part.startsWith('.'))
}

function readMoves(value: unknown): PathMove[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value) || !value.every((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false
    const item = entry as Record<string, unknown>
    return typeof item.id === 'string' && typeof item.source === 'string' && isWorkspacePath(item.source)
      && typeof item.target === 'string' && isWorkspacePath(item.target)
      && typeof item.ready === 'boolean' && item.metadata && typeof item.metadata === 'object'
  })) throw new Error('远端重命名记录无效，已停止远端操作')
  return value as PathMove[]
}

/** Keep pending operations bound to the original workspace and remote account. */
async function getMoveContext(): Promise<MoveContext | null> {
  const settings = await Store.load('store.json')
  const configuration = await getPathMoveConfiguration()
  if (!configuration) return null
  const { provider } = configuration
  const root = await getFilePathOptions('')
  if (provider === 'github') {
    // Retain the namespace used by the original GitHub journal.
    return {
      provider, key: JSON.stringify([root.path, root.baseDir, configuration.owner, configuration.repo]),
      journalName: 'github_path_moves.json',
    }
  }
  const proxyUrl = await settings.get<string>('proxy')
  const webdav = provider === 'webdav' ? await settings.get<WebDAVConfig>('webdavSyncConfig') : undefined
  const s3 = provider === 's3' ? await settings.get<S3Config>('s3SyncConfig') : undefined
  const cloudFolder = provider === 'cloudFolder' ? await settings.get<CloudFolderConfig>('cloudFolderSyncConfig') : undefined
  if ((provider === 'webdav' && !webdav) || (provider === 's3' && !s3) || (provider === 'cloudFolder' && !cloudFolder)) {
    throw syncStaleError({ stage: 'apply', check: 'configuration' })
  }
  return {
    provider, key: JSON.stringify([root.path, root.baseDir, provider, configuration.identity]),
    journalName: 'workspace_path_moves.json',
    webdav: webdav ? { ...webdav } : undefined,
    s3: s3 ? { ...s3 } : undefined,
    cloudFolder: cloudFolder ? { ...cloudFolder } : undefined,
    proxy: proxyUrl ? { all: proxyUrl } : undefined,
  }
}

export async function getWorkspacePathMoveContext(): Promise<string | null> {
  return (await getMoveContext())?.key || null
}

async function assertContext(context: MoveContext): Promise<void> {
  const settings = await Store.load('store.json')
  if (context.key !== await getWorkspacePathMoveContext() || await settings.get('platformSwitchRecovery')) {
    throw syncStaleError({ stage: 'apply', check: 'configuration' })
  }
}

async function localExists(path: string): Promise<boolean> {
  const options = await getFilePathOptions(path)
  return exists(options.path, { baseDir: options.baseDir })
}

function destination(entry: PathMove, later: PathMove[]): string {
  return pathAfterMoves(entry.target, later)
}

function pathAfterMoves(path: string, later: PathMove[]): string {
  return later.reduce((current, move) => current === move.source || current.startsWith(`${move.source}/`)
    ? `${move.target}${current.slice(move.source.length)}` : current, path)
}

async function reportMove(context: MoveContext, path: string, error?: unknown): Promise<void> {
  if (context.key !== await getWorkspacePathMoveContext()) return
  const settings = await Store.load('store.json')
  const workspacePath = (await settings.get<string>('workspacePath') || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  emitter.emit('sync-directory-completed', {
    path, workspacePath, provider: context.provider, success: error === undefined,
    error: error === undefined ? undefined
      : `本地已重命名，${context.provider} 远端重命名待重试：${error instanceof Error ? error.message : String(error)}`,
  })
}

/** Run only after the complete local transaction (including media rewrites).
 * Holding the journal lock also prevents another local rename during a remote
 * snapshot commit. Remote failure never rolls back a successful local move. */
export async function withWorkspacePathMoves<T>(
  moves: Array<{ source: string; target: string }>, move: () => Promise<T>,
): Promise<T> {
  const result = await serialize(async () => {
    const context = await getMoveContext()
    if (!context) return { value: await move(), context: null }
    await assertContext(context)
    const journal = await Store.load(context.journalName)
    const previous = readMoves(await journal.get(context.key))
    const additions: PathMove[] = []
    for (const { source, target } of moves) {
      if (!isWorkspacePath(source) || !isWorkspacePath(target) || source === target) continue
      if (context.provider === 'selfHosted') {
        // Reject an invalid destination before persisting a rename intent or
        // changing local files. Legacy source names may be repaired in place.
        await invoke<string>('self_hosted_move_source_path', { relativePath: source })
        await invoke('self_hosted_portable_path', { relativePath: target })
      }
      const options = await getFilePathOptions(source)
      const info = await lstat(options.path, { baseDir: options.baseDir })
      if (info.isSymlink || !(info.isFile || info.isDirectory)) continue
      additions.push({
        id: crypto.randomUUID(), source, target, ready: false,
        metadata: await capturePathMoveMetadata(source, target),
      })
    }
    if (!additions.length) return { value: await move(), context: null }
    await assertContext(context)
    await journal.set(context.key, [...previous, ...additions])
    await journal.save()
    let value: T
    try { value = await move() }
    catch (error) {
      // A complete local rollback cancels this batch. A partial rollback keeps
      // prepared records; recovery checks the actual paths before doing work.
      const rolledBack = (await Promise.all(additions.map(async entry =>
        await localExists(entry.source) && !await localExists(entry.target)))).every(Boolean)
      if (rolledBack) {
        await journal.set(context.key, previous)
        await journal.save()
      }
      throw error
    }
    try {
      await assertContext(context)
      const next = [...previous, ...additions]
      for (const entry of additions) {
        const sourceExists = await localExists(entry.source)
        const targetExists = await localExists(entry.target)
        if (sourceExists && !targetExists) {
          next.splice(next.indexOf(entry), 1) // Unstarted or rolled back item.
          continue
        }
        if (!sourceExists && targetExists) {
          await applyPathMoveMetadata(entry.metadata)
          entry.ready = true
        }
      }
      await journal.set(context.key, next)
      await journal.save()
    } catch (error) {
      await reportMove(context, additions[0].target, error)
    }
    return { value, context }
  })
  if (result.context) {
    // This call is outside the local rollback boundary and outside its lock.
    try { await retryWorkspacePathMoves() } catch { /* Reported with a retry action. */ }
  }
  return result.value
}

export function withWorkspacePathMove<T>(source: string, target: string, move: () => Promise<T>): Promise<T> {
  return withWorkspacePathMoves([{ source, target }], move)
}

/** Startup, online, manual retry and normal uploads share the ordered queue.
 * Pure remote moves preserve remote bytes, including directory-only children. */
export function retryWorkspacePathMoves(): Promise<void> {
  return serialize(async () => {
    const context = await getMoveContext()
    if (!context) return
    await assertContext(context)
    const journal = await Store.load(context.journalName)
    const entries = readMoves(await journal.get(context.key))
    const hadMoves = entries.length > 0
    while (entries.length) {
      const entry = entries[0]
      const finalTarget = destination(entry, entries.slice(1))
      try {
        await assertContext(context)
        const sourceExists = await localExists(entry.source)
        const targetExists = await localExists(finalTarget)
        if (!entry.ready && sourceExists && !await localExists(entry.target)) {
          entries.shift() // Prepared before a local operation that never happened.
          await journal.set(context.key, entries)
          await journal.save()
          continue
        }
        if (!targetExists) throw new Error(`本地重命名目标已不存在，已保留远端原路径：${entry.source} → ${finalTarget}`)
        if (sourceExists && finalTarget !== entry.source) throw new Error(`本地原路径和新路径同时存在，未覆盖或删除任何文件：${entry.source} → ${finalTarget}`)
        if (!entry.ready) {
          await applyPathMoveMetadata(entry.metadata)
          entry.ready = true
          await journal.set(context.key, entries)
          await journal.save()
        }
        const assertCurrent = async () => {
          await assertContext(context)
          return await localExists(finalTarget)
            && (!await localExists(entry.source) || finalTarget === entry.source)
        }
        const rememberSource = async (expected: unknown) => {
          await assertContext(context)
          entry.expected = expected
          await journal.set(context.key, entries)
          await journal.save()
        }
        const mapVersion = (file: { path: string; sourceVersion: string; targetVersion: string; sourceHash: string; targetHash: string }) => {
          const suffix = file.path ? `/${file.path}` : ''
          const target = `${entry.target}${suffix}`
          return {
            source: `${entry.source}${suffix}`, target,
            localTarget: pathAfterMoves(target, entries.slice(1)),
            sourceVersion: file.sourceVersion, targetVersion: file.targetVersion,
            sourceHash: file.sourceHash, targetHash: file.targetHash,
          }
        }
        if (context.provider === 'github') {
          if (entry.expected !== undefined && (!entry.expected || typeof entry.expected !== 'object' || !('sha' in entry.expected))) {
            throw new Error('GitHub 重命名版本记录无效')
          }
          await moveGithubPath({
            source: entry.source, target: entry.target, expected: entry.expected as GitPathEntry | undefined,
            rememberSource, assertCurrent,
          })
        } else if (context.provider === 'gitee' || context.provider === 'gitlab' || context.provider === 'gitea') {
          if (entry.expected !== undefined && !isGitPlatformPathSnapshot(entry.expected)) throw new Error('Git 重命名版本记录无效')
          await moveGitPlatformPath(context.provider, entry.source, entry.target, {
            expected: entry.expected, rememberSource, assertCurrent,
          })
        } else if (context.provider === 'webdav') {
          if (entry.expected !== undefined && (!entry.expected || typeof entry.expected !== 'object' || !('digest' in entry.expected))) {
            throw new Error('WebDAV 重命名版本记录无效')
          }
          if (!context.webdav) throw new Error('WebDAV 同步未配置')
          const result = await webdavMovePath(context.webdav, entry.source, entry.target, {
            expected: entry.expected as WebDAVPathIdentity | undefined, rememberSource, assertCurrent,
          }, context.proxy)
          if (result.status === 'moved') await rebindPathMoveMetadata(entry.metadata, (result.files || []).map(mapVersion), finalTarget)
        } else if (context.provider === 's3') {
          if (!context.s3) throw new Error('S3 同步未配置')
          const result = await s3MovePath(context.s3, entry.source, entry.target, {
            expected: entry.expected as S3PathIdentity | undefined, rememberSource, assertCurrent,
          }, context.proxy)
          if (result.status === 'moved') await rebindPathMoveMetadata(entry.metadata, (result.files || []).map(mapVersion), finalTarget)
        } else if (context.provider === 'cloudFolder') {
          if (!context.cloudFolder || (entry.expected !== undefined && typeof entry.expected !== 'string')) {
            throw new Error('云文件夹重命名记录无效')
          }
          const acceptedVersions = Object.fromEntries(Object.entries(entry.metadata.stores.syncedFileShas.source)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
          const result = await moveCloudFolderPath(context.cloudFolder, entry.source, entry.target, {
            expected: entry.expected, rememberSource, assertCurrent, acceptedVersions,
          })
          if (result.status === 'moved') await rebindPathMoveMetadata(entry.metadata, (result.files || []).map(file => ({
            ...file, localTarget: pathAfterMoves(file.target, entries.slice(1)),
          })), finalTarget)
        } else {
          const { moveSelfHostedRemotePath } = await import('@/lib/self-hosted-sync/path-move')
          await moveSelfHostedRemotePath(entry.source, entry.target, {
            expected: entry.expected, rememberSource, assertCurrent,
          })
        }
        await assertContext(context)
        entries.shift()
        await journal.set(context.key, entries)
        await journal.save()
        await reportMove(context, finalTarget)
      } catch (error) {
        await reportMove(context, finalTarget, error)
        throw error
      }
    }
    if (hadMoves && context.provider === 'selfHosted') {
      const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
      await getSelfHostedSyncRuntime().wake('workspace:path-moves-completed')
    }
  })
}

/** Uploads must not create a new path before its pending remote rename. */
export async function prepareWorkspacePathUpload(path: string): Promise<void> {
  await retryWorkspacePathMoves()
  // A queued upload for an old path must not recreate it after a rename.
  if (await getWorkspacePathMoveContext() && !await localExists(path)) {
    throw new Error(`本地路径已变化，已取消上传：${path}`)
  }
}

export function resumeWorkspacePathMoves(): void {
  void retryWorkspacePathMoves().catch(error => console.warn('Remote path move remains pending', error))
}

/** Outbox materialization reads this without acquiring the rename lock. Its
 * own pending path commands may be running while a rename is being replayed. */
export async function getPendingWorkspacePathMoves(): Promise<Array<{ source: string; target: string }>> {
  const context = await getMoveContext()
  if (!context) return []
  const journal = await Store.load(context.journalName)
  return readMoves(await journal.get(context.key)).map(({ source, target }) => ({ source, target }))
}

/** Inspect the destination's dormant journal before an authoritative switch. */
export async function hasPendingSelfHostedWorkspacePathMoves(workspaceIds: string[], profileId: string) {
  const journal = await Store.load('workspace_path_moves.json')
  for (const [key, value] of await journal.entries()) {
    let context: unknown
    try { context = JSON.parse(key) as unknown } catch { continue }
    if (!Array.isArray(context) || context[2] !== 'selfHosted' || typeof context[3] !== 'string') continue
    let identity: unknown
    try { identity = JSON.parse(context[3]) as unknown } catch { continue }
    if (!Array.isArray(identity) || identity[1] !== profileId || !workspaceIds.includes(String(identity[0]))) continue
    if (readMoves(value).length) return true
  }
  return false
}
