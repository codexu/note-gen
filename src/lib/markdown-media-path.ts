import { readDir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

import emitter from '@/lib/emitter'
import {
  getEditorPathMutationRevision,
  markEditorPathMutation,
  prepareActiveEditorDeactivation,
  runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'
import { resolveImagePathFromMarkdown, toMarkdownImagePath } from '@/lib/markdown-image-path'
import { getFilePathOptions } from '@/lib/workspace'
import useArticleStore from '@/stores/article'

export interface WorkspacePathMove {
  sourcePath: string
  targetPath: string
}

export interface RewrittenMarkdownFile {
  path: string
  content: string
}

type PendingMediaPathUpdate = RewrittenMarkdownFile & { previousContent: string }
type CommittedMediaPathUpdate = PendingMediaPathUpdate & { revision: number }

const MARKDOWN_FILE_RE = /\.(?:md|markdown)$/i
const EXTERNAL_MEDIA_PATH_RE = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i
const HTML_IMAGE_RE = /<img\b([^>]*?\bsrc\s*=\s*)(["'])(.*?)\2([^>]*)>/gi
const MARKDOWN_IMAGE_TITLE_RE = /^(.*)([\t ]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\)))$/

function normalizeWorkspacePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

function normalizeMoves(moves: WorkspacePathMove[]): WorkspacePathMove[] {
  return moves
    .map(move => ({
      sourcePath: normalizeWorkspacePath(move.sourcePath),
      targetPath: normalizeWorkspacePath(move.targetPath),
    }))
    .filter(move => move.sourcePath && move.targetPath && move.sourcePath !== move.targetPath)
    .sort((a, b) => b.sourcePath.length - a.sourcePath.length)
}

function mapPathForward(path: string, moves: WorkspacePathMove[]): string {
  const normalizedPath = normalizeWorkspacePath(path)
  const move = moves.find(candidate => (
    normalizedPath === candidate.sourcePath || normalizedPath.startsWith(`${candidate.sourcePath}/`)
  ))

  if (!move) return normalizedPath
  return `${move.targetPath}${normalizedPath.slice(move.sourcePath.length)}`
}

function mapPathBackward(path: string, moves: WorkspacePathMove[]): string {
  const normalizedPath = normalizeWorkspacePath(path)
  const move = [...moves]
    .sort((a, b) => b.targetPath.length - a.targetPath.length)
    .find(candidate => (
      normalizedPath === candidate.targetPath || normalizedPath.startsWith(`${candidate.targetPath}/`)
    ))

  if (!move) return normalizedPath
  return `${move.sourcePath}${normalizedPath.slice(move.targetPath.length)}`
}

function splitPathSuffix(path: string): { pathname: string; suffix: string } {
  const suffixIndex = path.search(/[?#]/)
  if (suffixIndex < 0) return { pathname: path, suffix: '' }
  return { pathname: path.slice(0, suffixIndex), suffix: path.slice(suffixIndex) }
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function preservePathEncoding(path: string, originalPath: string): string {
  return /%[\da-f]{2}/i.test(originalPath)
    ? path.split('/').map(segment => encodeURIComponent(segment)).join('/')
    : path
}

function isEscaped(content: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor--) {
    slashCount++
  }
  return slashCount % 2 === 1
}

function findClosingBracket(content: string, startIndex: number): number {
  let depth = 1
  for (let cursor = startIndex; cursor < content.length; cursor++) {
    if (isEscaped(content, cursor)) continue
    if (content[cursor] === '[') depth++
    if (content[cursor] === ']') depth--
    if (depth === 0) return cursor
  }
  return -1
}

function findClosingParenthesis(content: string, startIndex: number): number {
  let depth = 1
  let angleDestination = false
  let quote: '"' | "'" | null = null

  for (let cursor = startIndex; cursor < content.length; cursor++) {
    const character = content[cursor]
    if (isEscaped(content, cursor)) continue

    if (angleDestination) {
      if (character === '>') angleDestination = false
      continue
    }

    if (quote) {
      if (character === quote) quote = null
      continue
    }

    if (character === '<' && content.slice(startIndex, cursor).trim() === '') {
      angleDestination = true
      continue
    }
    if (
      (character === '"' || character === "'")
      && cursor > startIndex
      && /[\t ]/.test(content[cursor - 1])
    ) {
      quote = character
      continue
    }
    if (character === '(') depth++
    if (character === ')') depth--
    if (depth === 0) return cursor
  }

  return -1
}

function rewriteMarkdownImages(content: string, rewriteSource: (source: string) => string): string {
  let cursor = 0
  let rewritten = ''

  while (cursor < content.length) {
    const imageStart = content.indexOf('![', cursor)
    if (imageStart < 0) {
      rewritten += content.slice(cursor)
      break
    }

    if (isEscaped(content, imageStart)) {
      rewritten += content.slice(cursor, imageStart + 2)
      cursor = imageStart + 2
      continue
    }

    const altEnd = findClosingBracket(content, imageStart + 2)
    if (altEnd < 0 || content[altEnd + 1] !== '(') {
      rewritten += content.slice(cursor, imageStart + 2)
      cursor = imageStart + 2
      continue
    }

    const imageEnd = findClosingParenthesis(content, altEnd + 2)
    if (imageEnd < 0) {
      rewritten += content.slice(cursor)
      break
    }

    const destination = content.slice(altEnd + 2, imageEnd)
    const leadingWhitespace = destination.match(/^[\t ]*/)?.[0] ?? ''
    const trailingWhitespace = destination.match(/[\t ]*$/)?.[0] ?? ''
    const destinationBody = destination.slice(
      leadingWhitespace.length,
      destination.length - trailingWhitespace.length,
    )

    let source = destinationBody
    let title = ''
    if (destinationBody.startsWith('<')) {
      const angleEnd = destinationBody.indexOf('>')
      if (angleEnd >= 0) {
        source = destinationBody.slice(0, angleEnd + 1)
        title = destinationBody.slice(angleEnd + 1)
      }
    } else {
      const titleMatch = destinationBody.match(MARKDOWN_IMAGE_TITLE_RE)
      if (titleMatch) {
        source = titleMatch[1]
        title = titleMatch[2]
      }
    }

    rewritten += content.slice(cursor, altEnd + 2)
    rewritten += `${leadingWhitespace}${rewriteSource(source)}${title}${trailingWhitespace})`
    cursor = imageEnd + 1
  }

  return rewritten
}

export function collectLocalMarkdownImagePaths(
  content: string,
  markdownPath: string,
): string[] {
  const paths = new Set<string>()
  const normalizedMarkdownPath = normalizeWorkspacePath(markdownPath)
  const collectSource = (source: string) => {
    const wrappedInAngles = source.startsWith('<') && source.endsWith('>')
    const unwrappedSource = wrappedInAngles ? source.slice(1, -1) : source
    const { pathname } = splitPathSuffix(unwrappedSource)
    const decodedPathname = decodePath(pathname)

    if (
      !decodedPathname
      || EXTERNAL_MEDIA_PATH_RE.test(decodedPathname)
      || decodedPathname.startsWith('/')
      || decodedPathname.startsWith('\\')
    ) {
      return source
    }

    const resolvedPath = normalizeWorkspacePath(
      resolveImagePathFromMarkdown(normalizedMarkdownPath, decodedPathname),
    )
    if (
      resolvedPath
      && !resolvedPath.split('/').some(segment => segment.startsWith('.'))
    ) {
      paths.add(resolvedPath)
    }

    return source
  }

  rewriteMarkdownImages(content, collectSource)
  // Only image syntax is inspected. Ordinary Markdown links remain regular attachments.
  content.replace(
    HTML_IMAGE_RE,
    (_match, _before: string, _quote: string, source: string) => {
      collectSource(source)
      return _match
    },
  )

  return [...paths]
}

function rewriteMediaSource(
  source: string,
  previousMarkdownPath: string,
  currentMarkdownPath: string,
  moves: WorkspacePathMove[],
): string {
  const wrappedInAngles = source.startsWith('<') && source.endsWith('>')
  const unwrappedSource = wrappedInAngles ? source.slice(1, -1) : source
  const { pathname, suffix } = splitPathSuffix(unwrappedSource)
  const decodedPathname = decodePath(pathname)

  if (
    !decodedPathname
    || EXTERNAL_MEDIA_PATH_RE.test(decodedPathname)
    || decodedPathname.startsWith('/')
  ) {
    return source
  }

  const previousMediaPath = resolveImagePathFromMarkdown(previousMarkdownPath, decodedPathname)
  const currentMediaPath = mapPathForward(previousMediaPath, moves)
  const markdownMoved = previousMarkdownPath !== currentMarkdownPath
  const mediaMoved = previousMediaPath !== currentMediaPath

  if (!markdownMoved && !mediaMoved) return source

  const rewrittenPath = preservePathEncoding(
    toMarkdownImagePath(currentMarkdownPath, currentMediaPath),
    pathname,
  )
  const rewrittenSource = `${rewrittenPath}${suffix}`
  const safeSource = rewrittenSource.replace(/</g, '%3C').replace(/>/g, '%3E')
  return wrappedInAngles || /[\s()]/.test(safeSource) ? `<${safeSource}>` : safeSource
}

export function rewriteMarkdownMediaPaths(
  content: string,
  previousMarkdownPath: string,
  currentMarkdownPath: string,
  pathMoves: WorkspacePathMove[],
): string {
  const moves = normalizeMoves(pathMoves)
  if (moves.length === 0) return content

  const rewriteSource = (source: string) => rewriteMediaSource(
    source,
    normalizeWorkspacePath(previousMarkdownPath),
    normalizeWorkspacePath(currentMarkdownPath),
    moves,
  )

  return rewriteMarkdownImages(content, rewriteSource)
    .replace(HTML_IMAGE_RE, (_match, before: string, quote: string, source: string, after: string) => (
      `<img${before}${quote}${rewriteSource(source)}${quote}${after}>`
    ))
}

async function listWorkspaceMarkdownFiles(directory = ''): Promise<string[]> {
  const pathOptions = await getFilePathOptions(directory)
  const entries = pathOptions.baseDir
    ? await readDir(pathOptions.path, { baseDir: pathOptions.baseDir })
    : await readDir(pathOptions.path)
  const markdownFiles: string[] = []

  for (const entry of entries) {
    const relativePath = directory ? `${directory}/${entry.name}` : entry.name
    if (entry.isDirectory && !entry.isSymlink) {
      markdownFiles.push(...await listWorkspaceMarkdownFiles(relativePath))
    } else if (entry.isFile && MARKDOWN_FILE_RE.test(entry.name)) {
      markdownFiles.push(relativePath)
    }
  }

  return markdownFiles
}

async function readMarkdownFile(path: string): Promise<string> {
  const pathOptions = await getFilePathOptions(path)
  return pathOptions.baseDir
    ? await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
    : await readTextFile(pathOptions.path)
}

async function writeMarkdownFile(path: string, content: string): Promise<void> {
  const pathOptions = await getFilePathOptions(path)
  if (pathOptions.baseDir) {
    await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
  } else {
    await writeTextFile(pathOptions.path, content)
  }
}

export async function rewriteWorkspaceMarkdownMediaPaths(
  pathMoves: WorkspacePathMove[],
): Promise<RewrittenMarkdownFile[]> {
  const moves = normalizeMoves(pathMoves)
  if (moves.length === 0) return []

  const articleStore = useArticleStore.getState()
  const activeFilePath = normalizeWorkspacePath(articleStore.activeFilePath)
  const currentActivePath = mapPathForward(activeFilePath, moves)
  const markdownFiles = await listWorkspaceMarkdownFiles()
  const updates: PendingMediaPathUpdate[] = []

  for (const path of markdownFiles) {
    const previousPath = mapPathBackward(path, moves)
    const previousContent = previousPath === activeFilePath && MARKDOWN_FILE_RE.test(previousPath)
      ? articleStore.currentArticle
      : await readMarkdownFile(path)
    const content = rewriteMarkdownMediaPaths(previousContent, previousPath, path, moves)
    if (content !== previousContent || path === currentActivePath) {
      updates.push({ path, content, previousContent })
    }
  }

  // Commit the active document last so its canonical editor update can follow
  // the serialized disk write without awaiting unrelated files in between.
  updates.sort((left, right) => (
    Number(left.path === currentActivePath) - Number(right.path === currentActivePath)
  ))

  const written: CommittedMediaPathUpdate[] = []
  const committedUpdates: CommittedMediaPathUpdate[] = []
  try {
    for (const update of updates) {
      markEditorPathMutation(update.path)
      const committedUpdateRef: { current: CommittedMediaPathUpdate | null } = { current: null }
      const didCommit = await runEditorPathWriteTransaction(update.path, async ({ hasQueuedSave }) => {
        const latestContent = await readMarkdownFile(update.path)
        const previousPath = mapPathBackward(update.path, moves)
        const nextContent = rewriteMarkdownMediaPaths(
          latestContent,
          previousPath,
          update.path,
          moves,
        )
        if (nextContent === latestContent) return true

        try {
          await writeMarkdownFile(update.path, nextContent)
        } catch (writeError) {
          try {
            await writeMarkdownFile(update.path, latestContent)
          } catch (restoreError) {
            console.error(`Failed to restore Markdown after a media path write error: ${update.path}`, restoreError)
          }
          throw writeError
        }
        const targetIsActive = useArticleStore.getState().activeFilePath === update.path
        const editorIsStable = !targetIsActive || prepareActiveEditorDeactivation()
        if (!editorIsStable || hasQueuedSave()) {
          await writeMarkdownFile(update.path, latestContent)
          return false
        }
        markEditorPathMutation(update.path)
        committedUpdateRef.current = {
          path: update.path,
          content: nextContent,
          previousContent: latestContent,
          revision: getEditorPathMutationRevision(update.path),
        }
        return true
      })
      if (!didCommit) {
        throw new Error(`Markdown changed while rewriting media paths: ${update.path}`)
      }
      const committedUpdate = committedUpdateRef.current
      if (committedUpdate) {
        written.push(committedUpdate)
        committedUpdates.push(committedUpdate)
      }
    }
  } catch (error) {
    await Promise.allSettled(written.map(async update => {
      markEditorPathMutation(update.path)
      await runEditorPathWriteTransaction(update.path, async () => {
        const currentContent = await readMarkdownFile(update.path)
        if (currentContent !== update.content) return false
        await writeMarkdownFile(update.path, update.previousContent)
        markEditorPathMutation(update.path)
        return true
      })
    }))
    throw error
  }

  for (const update of committedUpdates) {
    if (getEditorPathMutationRevision(update.path) !== update.revision) continue
    emitter.emit('editor-file-content-updated', { path: update.path, content: update.content })
    const latestArticleStore = useArticleStore.getState()
    if (latestArticleStore.activeFilePath === update.path) {
      latestArticleStore.setCurrentArticle(update.content)
      emitter.emit('external-content-update', update.content)
    }
  }

  return committedUpdates.map(({ path, content }) => ({ path, content }))
}
