import { getWikiWorkspaceRevision, subscribeWikiWorkspaceChanges } from './wiki/context'
import { invalidateKnowledgeLexicalCache } from './knowledge-lexical-cache'

const imports = new Map<Promise<void>, number>()
let importRevision = 0

export function getKnowledgeArticleImportRevision() {
  return importRevision
}

/** Called after the picker closes and before the first workspace write. */
export function beginKnowledgeArticleImport() {
  const workspace = getWikiWorkspaceRevision()
  let done!: () => void
  const pending = new Promise<void>(resolve => { done = resolve })
  imports.set(pending, workspace)
  return () => {
    if (!imports.delete(pending)) return
    if (workspace === getWikiWorkspaceRevision()) {
      importRevision++
      invalidateKnowledgeLexicalCache()
    }
    done()
  }
}

/** A cancelled search releases its waiter without interrupting another search or import. */
export async function waitForKnowledgeArticleScan<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  let rejectWait!: (error: Error) => void
  const interrupted = new Promise<never>((_, reject) => { rejectWait = reject })
  const abort = () => rejectWait(new DOMException('Search aborted', 'AbortError'))
  const unsubscribe = subscribeWikiWorkspaceChanges(() => rejectWait(new Error('WIKI_CONTEXT_CHANGED')))
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  try {
    return await Promise.race([work, interrupted])
  } finally {
    signal?.removeEventListener('abort', abort)
    unsubscribe()
  }
}

export async function waitForKnowledgeArticleImports(signal?: AbortSignal) {
  const workspace = getWikiWorkspaceRevision()
  for (;;) {
    signal?.throwIfAborted()
    if (workspace !== getWikiWorkspaceRevision()) throw new Error('WIKI_CONTEXT_CHANGED')
    const pending = Array.from(imports).filter(([, revision]) => revision === workspace)
    if (!pending.length) return
    await waitForKnowledgeArticleScan(Promise.all(pending.map(([task]) => task)), signal)
  }
}
