import { join } from '@tauri-apps/api/path'
import { lstat } from '@tauri-apps/plugin-fs'
import { getComparableEditorPath, getCurrentEditorWorkspaceRoot } from '@/lib/editor-deactivation'
import { isAbsoluteFsPath } from '@/lib/workspace'
import { ensureWikiWorkspaceRelativePath } from '@/lib/wiki/path'

/** Standalone sessions keep their absolute document path and pin their own workspace root. */
export async function resolveWikiCitationWindowNote(path: string) {
  const root = await getCurrentEditorWorkspaceRoot()
  const segments = path.replaceAll('\\', '/').split('/')
  if (segments.some(part => part === '.' || part === '..')) throw new Error('WIKI_INVALID_PATH')
  let relative = path
  if (isAbsoluteFsPath(path)) {
    const comparable = getComparableEditorPath(path, root)
    if (comparable?.namespace !== 'relative' || !comparable.value) throw new Error('WIKI_INVALID_PATH')
    // Comparison can fold Windows paths to lowercase. Preserve the actual filename.
    relative = segments.slice(-comparable.value.split('/').length).join('/')
  }
  relative = ensureWikiWorkspaceRelativePath(relative)
  if (!/\.(md|markdown)$/i.test(relative)) throw new Error('WIKI_INVALID_PATH')
  const parts = relative.split('/')
  let absolute = root
  for (const [index, part] of parts.entries()) {
    absolute = await join(absolute, part)
    const info = await lstat(absolute)
    if (info.isSymlink || (index === parts.length - 1 ? !info.isFile : !info.isDirectory)) throw new Error('WIKI_SOURCE_NOT_FOUND')
  }
  return { relative, absolute, name: parts[parts.length - 1] }
}
