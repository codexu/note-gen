import { WIKI_ROOT_FOLDER } from '@/types/wiki'

/** A workspace-relative filesystem identity, without trimming or article/ aliases. */
export function ensureWikiWorkspaceRelativePath(path: string): string {
  const relative = path.replaceAll('\\', '/')
  if (!relative || relative.length > 4000 || relative.startsWith('/')
    || /[\u0000-\u001f\u007f:]/.test(relative)
    || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('WIKI_INVALID_PATH')
  }
  return relative
}

function relativeWikiPath(path: string): string | null {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null
  if (normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null
  return normalized
}

/** Only the reserved workspace-root Wiki directory, not a same-named nested folder. */
export function isWikiRootFolder(path: string): boolean {
  return relativeWikiPath(path) === WIKI_ROOT_FOLDER
}

export function isWikiFolderPath(path: string): boolean {
  const normalized = relativeWikiPath(path)
  return normalized === WIKI_ROOT_FOLDER || Boolean(normalized?.startsWith(`${WIKI_ROOT_FOLDER}/`))
}
