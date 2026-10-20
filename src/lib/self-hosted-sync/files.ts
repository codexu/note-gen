import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { getDb } from '@/db'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'
import { enqueueAssetSnapshot, enqueueFileSnapshot, enqueueFolderSnapshot } from './outbox'
import { getSelfHostedSyncRuntime } from './runtime'

function normalizeSlashes(path: string) {
  return path.normalize('NFC').replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
}

function workspaceRelativePath(path: string, workspaceRoot: string) {
  const normalizedPath = normalizeSlashes(path.trim())
  const normalizedRoot = normalizeSlashes(workspaceRoot.trim())
  const windowsAbsolute = /^[a-zA-Z]:\//.test(normalizedPath)
  const absolute = normalizedPath.startsWith('/') || windowsAbsolute
  if (!absolute) return normalizedPath.replace(/^\.\//, '') || null

  const comparablePath = windowsAbsolute ? normalizedPath.toLocaleLowerCase() : normalizedPath
  const comparableRoot = windowsAbsolute ? normalizedRoot.toLocaleLowerCase() : normalizedRoot
  if (!comparablePath.startsWith(`${comparableRoot}/`)) return null
  return normalizedPath.slice(normalizedRoot.length + 1) || null
}

export async function moveSelfHostedWorkspacePath(sourceRelativePath: string, targetRelativePath: string) {
  const store = await Store.load('store.json')
  if (await store.get<string>('primaryBackupMethod') !== 'selfHosted') return false
  const workspace = await getWorkspacePath()
  const workspaceRoot = workspace.isCustom ? workspace.path : await getDefaultArticleAbsolutePath('')
  const database = await getDb()
  const bindings = await database.select<Array<{ workspaceId: string }>>(
    `select workspace_id as workspaceId from self_hosted_workspace_bindings
     where local_root = $1 and binding_state = 'bound' limit 1`,
    [workspaceRoot]
  )
  const workspaceId = bindings[0]?.workspaceId
  if (!workspaceId) return false
  const normalizedSourcePath = workspaceRelativePath(sourceRelativePath, workspaceRoot)
  const normalizedTargetPath = workspaceRelativePath(targetRelativePath, workspaceRoot)
  if (!normalizedSourcePath || !normalizedTargetPath) return false
  await invoke('self_hosted_move_path', {
    workspaceId,
    workspaceRoot,
    sourceRelativePath: normalizedSourcePath,
    targetRelativePath: normalizedTargetPath,
  })
  return true
}

export async function writeSelfHostedWorkspaceText(relativePath: string, content: string) {
  const binding = await activeBinding()
  if (!binding) return false
  const normalizedPath = workspaceRelativePath(relativePath, binding.workspaceRoot)
  if (!normalizedPath) return false
  const database = await getDb()
  const mappings = await database.select<Array<{ objectId: string }>>(
    `select object_id as objectId from self_hosted_object_mappings
     where workspace_id = $1 and relative_path = $2 and deleted_at is null limit 1`,
    [binding.workspaceId, normalizedPath]
  )
  const bytes = new TextEncoder().encode(content)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  await invoke('self_hosted_atomic_write', {
    workspaceId: binding.workspaceId,
    objectId: mappings[0]?.objectId ?? null,
    workspaceRoot: binding.workspaceRoot,
    relativePath: normalizedPath,
    contents: btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    expectedHash: await invoke<string>('self_hosted_sha256', { value: content }),
  })
  return true
}

export async function deleteSelfHostedWorkspacePath(
  relativePath: string,
  pathKind?: 'file' | 'folder',
) {
  const binding = await activeBinding()
  if (!binding) return false
  const normalizedPath = workspaceRelativePath(relativePath, binding.workspaceRoot)
  if (!normalizedPath) return false
  const database = await getDb()
  const mappings = await database.select<Array<{
    objectId: string
    kind: string
    relativePath: string
  }>>(
    `select object_id as objectId, kind, relative_path as relativePath
     from self_hosted_object_mappings
     where workspace_id = $1 and deleted_at is null
       and (relative_path = $2 or relative_path like $3 escape '\\')
     order by
       case when kind = 'folder' then 1 else 0 end,
       length(relative_path) desc`,
    [binding.workspaceId, normalizedPath, `${escapeLike(normalizedPath)}/%`]
  )
  const mapping = mappings.find(item => item.relativePath === normalizedPath)
  if (mapping?.kind === 'folder' || (!mapping && pathKind === 'folder')) {
    await invoke('self_hosted_delete_directory', {
      workspaceId: binding.workspaceId,
      objectId: mapping?.objectId ?? null,
      workspaceRoot: binding.workspaceRoot,
      relativePath: normalizedPath,
      allowNonEmpty: true,
    })
  } else {
    await invoke('self_hosted_delete_file', {
      workspaceId: binding.workspaceId,
      objectId: mapping?.objectId ?? null,
      workspaceRoot: binding.workspaceRoot,
      relativePath: normalizedPath,
      expectedHash: null,
    })
  }
  for (const item of mappings) {
    if (item.kind === 'folder') {
      await enqueueFolderSnapshot(item.relativePath, 'delete', binding.workspaceId)
    } else if (item.kind === 'asset') {
      await enqueueAssetSnapshot(item.relativePath, 'delete', binding.workspaceId)
    } else if (item.kind === 'note') {
      await enqueueFileSnapshot(item.relativePath, 'delete', binding.workspaceId)
    }
  }
  void getSelfHostedSyncRuntime().wake('workspace:explicit-delete')
  return true
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

async function activeBinding() {
  const store = await Store.load('store.json')
  if (await store.get<string>('primaryBackupMethod') !== 'selfHosted') return null
  const workspace = await getWorkspacePath()
  const workspaceRoot = workspace.isCustom ? workspace.path : await getDefaultArticleAbsolutePath('')
  const database = await getDb()
  const bindings = await database.select<Array<{ workspaceId: string }>>(
    `select workspace_id as workspaceId from self_hosted_workspace_bindings
     where local_root = $1 and binding_state = 'bound' limit 1`,
    [workspaceRoot]
  )
  return bindings[0] ? { ...bindings[0], workspaceRoot } : null
}
