import emitter from '@/lib/emitter'
import useArticleStore from '@/stores/article'
import { exists, lstat, readTextFile } from '@tauri-apps/plugin-fs'
import { createFileTool, deleteMarkdownFileTool, updateMarkdownFileTool } from '@/lib/agent/tools/note-tools'
import { getSkillWorkspaceIdentity } from '@/lib/skills/runtime'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { safeNotePath } from './detect'
import { OrganizeConflict } from './transaction'

export async function currentWorkspaceIdentity() {
  return getSkillWorkspaceIdentity(await getWorkspacePath())
}

/** Resolve and verify that the file and its parents aren't symlinks out of the indexed vault. */
async function checkedFile(path: string, identity: string) {
  if (!safeNotePath(path) || await currentWorkspaceIdentity() !== identity
    || await ensureSafeWorkspaceRelativePath(path) !== path) throw new OrganizeConflict()
  const parts = path.split('/')
  let parent = ''
  for (const segment of parts.slice(0, -1)) {
    parent = parent ? parent + '/' + segment : segment
    const options = await getFilePathOptions(parent)
    if (!await exists(options.path, options)) continue
    const info = await lstat(options.path, options)
    if (!info.isDirectory || info.isSymlink) throw new OrganizeConflict()
  }
  const options = await getFilePathOptions(path)
  // exists may follow symlinks, including broken ones. lstat sees the link itself.
  const info = await lstat(options.path, options).catch(async error => {
    if (await exists(options.path, options)) throw error
    return null
  })
  if (info && (!info.isFile || info.isSymlink)) throw new OrganizeConflict()
  if (await currentWorkspaceIdentity() !== identity) throw new OrganizeConflict()
  return { options, info }
}

export async function inspectNote(path: string, identity: string) {
  const { info } = await checkedFile(path, identity)
  return info && { mtime: info.mtime?.getTime() ?? 0, size: info.size }
}

export async function readOrganizeNote(path: string, identity: string, maxBytes = Infinity): Promise<string | null> {
  const { info, options } = await checkedFile(path, identity)
  if (!info || info.size > maxBytes) return null
  return readTextFile(options.path, options)
}

/** Reuse editor-coordinated, workspace-pinned note tools. Restore uses exclusive creation. */
export async function replaceOrganizeNote(path: string, identity: string, expected: string | null, content: string | null) {
  if (await readOrganizeNote(path, identity) !== expected) throw new OrganizeConflict()
  const result = expected === null
    ? await createFileTool.execute({ fileName: path, content, workspaceIdentity: identity })
    : content === null
      ? await deleteMarkdownFileTool.execute({ filePath: path, expectedContent: expected, workspaceIdentity: identity })
      : await updateMarkdownFileTool.execute({ filePath: path, expectedContent: expected, content, workspaceIdentity: identity })
  // Some tools can finish the filesystem mutation before a UI refresh fails.
  if (!result.success && await readOrganizeNote(path, identity) !== content) throw new OrganizeConflict()
  try {
    if (content !== null && await currentWorkspaceIdentity() === identity) {
      useArticleStore.getState().markFileDirty(path)
      emitter.emit('article-saved', { path, content, pluginChangeType: expected === null ? 'created' : 'changed' })
    }
  } catch (error) {
    console.debug('[organize] editor refresh failed', error)
  }
}
