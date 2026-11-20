import type { KnowledgeSource, KnowledgeSourceDocument } from '@/types/knowledge'
import { getWikiWorkspaceRevision } from './wiki/context'

interface LexicalEntry {
  signature: string
  text: string
}

// This is a negative filter for the original-source fallback. A possible hit
// is always read from the source again before any excerpts are returned.
const entries = new Map<string, LexicalEntry>()
const MAX_CHARACTERS = 8 * 1024 * 1024
let characters = 0
let workspace = -1
let changes = 0

export function invalidateKnowledgeLexicalCache(key?: string) {
  changes++
  if (key === undefined) {
    entries.clear()
    characters = 0
  } else {
    characters -= entries.get(key)?.text.length ?? 0
    entries.delete(key)
  }
}

export async function lookupKnowledgeLexicalText(source: KnowledgeSource) {
  const revision = getWikiWorkspaceRevision()
  if (workspace !== revision) {
    invalidateKnowledgeLexicalCache()
    workspace = revision
  }
  const version = changes
  let file: string | null = 'registry'
  if (source.sourceType === 'article') {
    const { getWikiArticleFileSignature } = await import('./wiki/files')
    file = await getWikiArticleFileSignature(source.locator.filePath || source.sourceId).catch(() => null)
  }
  const signature = file && JSON.stringify([source.contentHash, file])
  const old = entries.get(source.sourceKey)
  return {
    text: old && old.signature === signature ? old.text : undefined,
    remember(document: KnowledgeSourceDocument) {
      if (!signature || version !== changes || revision !== getWikiWorkspaceRevision()) return
      if (source.sourceType !== 'article' && source.contentHash !== document.contentHash) return
      const text = document.chunks.map(chunk => chunk.content.toLocaleLowerCase()).join('\n')
      if (text.length > MAX_CHARACTERS) return
      characters -= entries.get(source.sourceKey)?.text.length ?? 0
      entries.delete(source.sourceKey)
      entries.set(source.sourceKey, { signature, text })
      characters += text.length
      while (characters > MAX_CHARACTERS) {
        const first = entries.entries().next().value
        if (!first) break
        characters -= first[1].text.length
        entries.delete(first[0])
      }
    },
  }
}
