import { join } from '@tauri-apps/api/path'
import { BaseDirectory, readDir, readTextFile, stat, type FileInfo } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { createHash } from 'crypto'
import { getBM25StructuredSourceRevisions, isBM25SourceRevisionCurrent } from '@/db/bm25-source-revisions'
import { getCanvasProject } from '@/db/canvases'
import { getMarkById } from '@/db/marks'
import { getCanvasKnowledgeDocument, getRecordKnowledgeDocument } from './knowledge-content'
import { DEFAULT_EXCLUDED_RAG_PATHS, isPathAllowedForRag } from './rag-retrieval-policy'
import { recordTagIds } from './record-tags'
import { getWorkspacePath } from './workspace'
import { createKnowledgeSourceKey } from '@/types/knowledge'

export interface BM25Source {
  signature: string
  readChunks: () => Promise<string[]>
}

export class BM25SourceUnavailableError extends Error {
  constructor(readonly sourceKey: string, cause: unknown) {
    super(`Could not read BM25 source: ${sourceKey}`, { cause })
    this.name = 'BM25SourceUnavailableError'
  }
}

export class BM25SourceChangedError extends Error {
  constructor(readonly sourceKey: string) {
    super(`BM25 source changed during read: ${sourceKey}`)
    this.name = 'BM25SourceChangedError'
  }
}

// Bump when tokenization or source serialization changes so old chunks are replaced.
const FORMAT_VERSION = 1

function fileVersion(info: FileInfo): string | null {
  return info.mtime ? [info.size, info.mtime.getTime(), info.birthtime?.getTime(), info.dev, info.ino].join(':') : null
}

function contentVersion(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

function isMissingFile(error: unknown) {
  return /no such file or directory|(?:file|path) not found|os error (?:2|3)\b/i.test(String(error))
}

export async function getBM25Sources(isCurrent: () => boolean) {
  const ensureCurrent = () => {
    if (!isCurrent()) throw new Error('BM25 source inventory changed')
  }
  const sources = new Map<string, BM25Source>()
  const unreadable = new Set<string>()
  const [workspace, store] = await Promise.all([getWorkspacePath(), Store.load('store.json')])
  const [chunkSize, chunkOverlap, excluded] = await Promise.all([
    store.get<number>('ragChunkSize'), store.get<number>('ragChunkOverlap'), store.get<string[]>('ragExcludedPaths'),
  ])
  const scope = { excludedPaths: excluded ?? DEFAULT_EXCLUDED_RAG_PATHS }
  const options = workspace.isCustom ? {} : { baseDir: BaseDirectory.AppData }

  // Only I/O errors protect an existing row from deletion. Configuration and database errors abort reconciliation.
  async function discover<T>(key: string, operation: Promise<T>): Promise<T | undefined> {
    try { return await operation } catch (error) {
      ensureCurrent()
      // Before the first note is created, the default article directory may not exist.
      if (key !== 'article:' || workspace.isCustom || !isMissingFile(error)) unreadable.add(key)
      return undefined
    }
  }

  function readFailed(key: string, cause: unknown): never {
    ensureCurrent()
    if (isMissingFile(cause)) throw new BM25SourceChangedError(key)
    throw new BM25SourceUnavailableError(key, cause)
  }

  async function visit(directory: string, prefix: string): Promise<void> {
    ensureCurrent()
    const entries = await discover(createKnowledgeSourceKey('article', prefix), readDir(directory, options))
    if (!entries) return
    for (const entry of entries) {
      ensureCurrent()
      if (entry.isSymlink || entry.name.startsWith('.')) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (!isPathAllowedForRag(relative, scope)) continue
      if (!entry.isDirectory && !entry.name.endsWith('.md')) continue
      const path = await join(directory, entry.name)
      if (workspace.isCustom && !isPathAllowedForRag(path, scope)) continue
      if (entry.isDirectory) {
        await visit(path, relative)
        continue
      }
      const key = createKnowledgeSourceKey('article', relative)
      const info = await discover(key, stat(path, options))
      if (!info?.isFile) continue
      const metadata = fileVersion(info)
      let version = metadata
      if (version === null) {
        // Some mobile providers omit timestamps. Only such files need a content hash during discovery.
        const text = await discover(key, readTextFile(path, options))
        if (text === undefined) continue
        version = contentVersion(text)
      }
      sources.set(key, {
        signature: JSON.stringify([FORMAT_VERSION, chunkSize, chunkOverlap, version]),
        async readChunks() {
          ensureCurrent()
          const onError = (cause: unknown) => readFailed(key, cause)
          const text = await readTextFile(path, options).catch(onError)
          const currentVersion = metadata === null ? contentVersion(text) : fileVersion(await stat(path, options).catch(onError))
          if (currentVersion !== version) throw new BM25SourceChangedError(key)
          const { chunkText } = await import('./rag')
          ensureCurrent()
          return chunkText(text, chunkSize, chunkOverlap)
        },
      })
    }
  }

  await visit(workspace.path, '')
  ensureCurrent()
  const { records, canvases, tags } = await getBM25StructuredSourceRevisions()
  const tagNames = new Map(tags.map(tag => [tag.id, tag.name]))
  for (const record of records) {
    let tagIds: unknown
    try { tagIds = record.tagIds && JSON.parse(record.tagIds) } catch { /* Legacy records use the primary tag. */ }
    const assigned = recordTagIds({ tagId: record.tagId, tagIds: Array.isArray(tagIds) ? tagIds : undefined })
    const key = createKnowledgeSourceKey('record', record.id)
    sources.set(key, {
      signature: JSON.stringify([FORMAT_VERSION, record.revision, assigned.map(id => [id, tagNames.get(id)])]),
      async readChunks() {
        ensureCurrent()
        const mark = await getMarkById(record.id)
        const document = mark && await getRecordKnowledgeDocument(mark, tags)
        if (!document || !await isBM25SourceRevisionCurrent(key, record.revision)) throw new BM25SourceChangedError(key)
        ensureCurrent()
        return document.chunks.map(chunk => chunk.content)
      },
    })
  }
  for (const canvas of canvases) {
    const key = createKnowledgeSourceKey('canvas', canvas.id)
    sources.set(key, {
      signature: JSON.stringify([FORMAT_VERSION, canvas.revision]),
      async readChunks() {
        ensureCurrent()
        const project = await getCanvasProject(canvas.id)
        const document = project && await getCanvasKnowledgeDocument(project)
        if (!document || !await isBM25SourceRevisionCurrent(key, canvas.revision)) throw new BM25SourceChangedError(key)
        ensureCurrent()
        return document.chunks.map(chunk => chunk.content)
      },
    })
  }
  ensureCurrent()
  return { sources, unreadable }
}
