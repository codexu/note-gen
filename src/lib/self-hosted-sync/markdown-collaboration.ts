import * as Y from 'yjs'
import {
  openCollaborativeDocument,
  type PresenceCoordinateSpace,
} from './collaboration'

const LOCAL_ORIGIN = Symbol('notegen-local-editor')
const REMOTE_ORIGIN = Symbol('notegen-remote-sync')

export interface MarkdownCollaborationController {
  markLocalActivity(): void
  applyLocal(markdown: string): void
  updatePresence(
    anchor: number,
    head: number,
    label: string,
    coordinateSpace: PresenceCoordinateSpace,
  ): void
  clearPresence(): void
  subscribePresence(listener: (message: Record<string, unknown>) => void): () => void
  close(): void
}

export async function openMarkdownCollaboration(
  localRoot: string,
  relativePath: string,
  initialMarkdown: string,
  onRemoteMarkdown: (markdown: string) => void,
): Promise<MarkdownCollaborationController> {
  const transport = await openCollaborativeDocument(localRoot, relativePath)
  console.info('[self-hosted-sync] markdown.session-opened', {
    relativePath,
    workspaceId: transport.workspaceId,
    documentId: transport.documentId,
  })
  const document = new Y.Doc()
  // Predeclare every released root with its original constructor before
  // applying an update. Otherwise Yjs creates an untyped AbstractType and the
  // legacy content cannot be discovered safely afterwards.
  const legacyText = document.getText('markdown')
  const legacyV2 = document.getMap<Y.Text>('markdown-v2')
  const text = document.getText('markdown-v3')
  const metadata = document.getMap('markdown-v3-meta')
  let closed = false
  let localUpdateCount = 0
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null
  let consumeQueue = Promise.resolve()
  let appendQueue = Promise.resolve()

  async function checkpoint() {
    if (closed) return
    localUpdateCount = 0
    if (checkpointTimer) clearTimeout(checkpointTimer)
    checkpointTimer = null
    await appendQueue
    await transport.flush()
    if (closed) return
    await transport.checkpoint(Y.encodeStateAsUpdate(document))
  }

  document.on('update', (update: Uint8Array, origin: unknown) => {
    if (closed || origin === REMOTE_ORIGIN) return
    appendQueue = appendQueue
      .then(() => transport.appendUpdate(update))
      .catch(error => console.warn('[self-hosted-sync] Unable to append collaborative update', error))
    localUpdateCount++
    if (localUpdateCount >= 100) void checkpoint()
    else if (!checkpointTimer) checkpointTimer = setTimeout(() => void checkpoint(), 5 * 60_000)
  })

  const applyRemoteUpdate = (update: Uint8Array) => {
    Y.applyUpdate(document, update, REMOTE_ORIGIN)
  }
  const legacyV2Text = () => {
    const value = legacyV2.get('content')
    return value instanceof Y.Text ? value : null
  }
  const legacyMarkdown = () => legacyV2Text()?.toString() ?? legacyText.toString()
  const isV3Initialized = () => metadata.get('initialized') === true
  const sharedText = () => (
    isV3Initialized() ? text : legacyV2Text() ?? legacyText
  )
  const currentMarkdown = () => (
    isV3Initialized() ? text.toString() : legacyMarkdown()
  )
  const consumeRemoteUpdates = (strict = false) => {
    const previous = consumeQueue
    let receivedRemoteUpdate = false
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          await transport.consume(update => {
            receivedRemoteUpdate = true
            const previousMarkdown = currentMarkdown()
            applyRemoteUpdate(update)
            const nextMarkdown = currentMarkdown()
            if (!closed && nextMarkdown !== previousMarkdown) onRemoteMarkdown(nextMarkdown)
          })
        } catch (error) {
          if (strict && !receivedRemoteUpdate) throw error
          console.warn('[self-hosted-sync] Unable to pull collaborative update', error)
        }
        return receivedRemoteUpdate
      })
    consumeQueue = operation.then(() => undefined).catch(error => {
      console.warn('[self-hosted-sync] Unable to consume collaborative update', error)
    })
    return strict ? operation : consumeQueue.then(() => receivedRemoteUpdate)
  }

  let stopRealtime: (() => void) | null = null
  let realtimeFallbackTimer: ReturnType<typeof setInterval> | null = null
  try {
    const hasRemoteBaseline = await consumeRemoteUpdates(true)
    if (!hasRemoteBaseline) {
      // Build the first v3 state in an isolated document. It must not enter the
      // live Y.Doc until the server's compare-and-set command has accepted it;
      // a concurrent loser discards this candidate and pulls the winner.
      const seed = new Y.Doc()
      const seedText = seed.getText('markdown-v3')
      if (initialMarkdown) seedText.insert(0, initialMarkdown)
      seed.getMap('markdown-v3-meta').set('initialized', true)
      const initializationUpdate = Y.encodeStateAsUpdate(seed)
      seed.destroy()
      await transport.initialize(initializationUpdate)
      const receivedAuthoritativeBaseline = await consumeRemoteUpdates(true)
      if (!receivedAuthoritativeBaseline || !isV3Initialized()) {
        throw new Error('协作文档初始化后未能读取服务端权威基线')
      }
    }

    stopRealtime = transport.subscribePresence(message => {
      if (message.type === 'document.sync-request' || message.type === 'workspace.changed'
        || message.type === 'inbox.applied') {
        void consumeRemoteUpdates()
      }
    })
    realtimeFallbackTimer = setInterval(() => void consumeRemoteUpdates(), 2_000)

    return {
      markLocalActivity() {},
      applyLocal(markdown) {
        const shared = sharedText()
        if (markdown === shared.toString()) return
        const previous = shared.toString()
        const prefix = commonPrefix(previous, markdown)
        const suffix = commonSuffix(previous, markdown, prefix)
        document.transact(() => {
          const removed = previous.length - prefix - suffix
          if (removed > 0) shared.delete(prefix, removed)
          const inserted = markdown.slice(prefix, markdown.length - suffix)
          if (inserted) shared.insert(prefix, inserted)
        }, LOCAL_ORIGIN)
      },
      updatePresence: transport.updatePresence,
      clearPresence: transport.clearPresence,
      subscribePresence: transport.subscribePresence,
      close() {
        closed = true
        if (checkpointTimer) clearTimeout(checkpointTimer)
        if (realtimeFallbackTimer) clearInterval(realtimeFallbackTimer)
        stopRealtime?.()
        transport.close()
        document.destroy()
      },
    }
  } catch (error) {
    closed = true
    if (checkpointTimer) clearTimeout(checkpointTimer)
    if (realtimeFallbackTimer) clearInterval(realtimeFallbackTimer)
    stopRealtime?.()
    transport.close()
    document.destroy()
    throw error
  }
}

function commonPrefix(left: string, right: string) {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index++
  return index
}

function commonSuffix(left: string, right: string, prefix: number) {
  const limit = Math.min(left.length, right.length) - prefix
  let index = 0
  while (index < limit && left[left.length - 1 - index] === right[right.length - 1 - index]) index++
  return index
}
