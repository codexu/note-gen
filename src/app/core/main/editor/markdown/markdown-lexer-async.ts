import type { TokensList } from 'marked'
import { MARKDOWN_LEXER_VERSION, type MarkdownLexerRequest, type MarkdownLexerResponse } from './markdown-lexer-protocol'

export interface PreparedMarkdownTokens {
  source: string
  tokens: TokensList
  tokenizerNames: readonly string[]
  durationMs: number
  elapsedMs: number
}

interface TokenConsumer {
  resolve(value: PreparedMarkdownTokens | null): void
  dispose(): void
}

interface TokenJob {
  requestId: number
  filePath: string
  source: string
  startedAt: number
  consumers: Set<TokenConsumer>
  timeout?: ReturnType<typeof setTimeout>
}

const MAX_PENDING_JOBS = 4
const MAX_PREPARED_FILES = 2
const WORKER_TIMEOUT_MS = 10_000
const WORKER_RETRY_DELAY_MS = 30_000

const jobs = new Set<TokenJob>()
const queue: TokenJob[] = []
const preparedFiles = new Map<string, PreparedMarkdownTokens>()
let worker: Worker | null = null
let workerReady = false
let workerReadyTimeout: ReturnType<typeof setTimeout> | undefined
let runningJob: TokenJob | undefined
let nextRequestId = 0
let retryWorkerAt = 0

function stopWorker() {
  worker?.terminate()
  worker = null
  workerReady = false
  clearTimeout(workerReadyTimeout)
  workerReadyTimeout = undefined
}

function settleJob(job: TokenJob, result: PreparedMarkdownTokens | null) {
  if (!jobs.delete(job)) return
  clearTimeout(job.timeout)
  const queueIndex = queue.indexOf(job)
  if (queueIndex !== -1) queue.splice(queueIndex, 1)
  if (runningJob === job) runningJob = undefined

  if (result) {
    preparedFiles.delete(job.filePath)
    preparedFiles.set(job.filePath, result)
    while (preparedFiles.size > MAX_PREPARED_FILES) {
      const oldestPath = preparedFiles.keys().next().value
      if (oldestPath === undefined) break
      preparedFiles.delete(oldestPath)
    }
  }

  for (const consumer of job.consumers) {
    consumer.dispose()
    consumer.resolve(result)
  }
  job.consumers.clear()
}

function failWorker() {
  stopWorker()
  retryWorkerAt = Date.now() + WORKER_RETRY_DELAY_MS
  for (const job of [...jobs]) settleJob(job, null)
}

function ensureWorker() {
  if (worker) return true
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || Date.now() < retryWorkerAt) return false

  try {
    // Bundle this entry independently to avoid Turbopack's Worker bootstrap.
    const nextWorker = new window.Worker(`/markdown-lexer.js?v=${MARKDOWN_LEXER_VERSION}`, { type: 'module', name: 'notegen-markdown-lexer' })
    worker = nextWorker
    workerReadyTimeout = setTimeout(failWorker, WORKER_TIMEOUT_MS)
    nextWorker.onmessage = ({ data }: MessageEvent<MarkdownLexerResponse>) => {
      if (worker !== nextWorker) return
      if (data.version !== MARKDOWN_LEXER_VERSION) {
        failWorker()
        return
      }
      if (data.type === 'ready') {
        clearTimeout(workerReadyTimeout)
        workerReadyTimeout = undefined
        workerReady = true
        dispatchNextJob()
        return
      }

      const job = runningJob
      if (!job || job.requestId !== data.requestId) return
      settleJob(job, data.type === 'tokens' ? {
        source: job.source,
        tokens: data.tokens,
        tokenizerNames: data.tokenizerNames,
        durationMs: data.durationMs,
        elapsedMs: performance.now() - job.startedAt,
      } : null)
      dispatchNextJob()
    }
    nextWorker.onerror = (event) => {
      if (worker !== nextWorker) return
      event.preventDefault()
      failWorker()
    }
    nextWorker.onmessageerror = () => {
      if (worker === nextWorker) failWorker()
    }
    return true
  } catch {
    failWorker()
    return false
  }
}

function dispatchNextJob() {
  if (runningJob || queue.length === 0) return
  if (!ensureWorker()) {
    for (const job of [...jobs]) settleJob(job, null)
    return
  }
  if (!workerReady || !worker) return

  const job = queue.shift()
  if (!job) return
  runningJob = job
  job.timeout = setTimeout(failWorker, WORKER_TIMEOUT_MS)
  const request: MarkdownLexerRequest = { type: 'tokenize', version: MARKDOWN_LEXER_VERSION, requestId: job.requestId, source: job.source }
  try {
    worker.postMessage(request)
  } catch {
    failWorker()
  }
}

function discardJob(job: TokenJob) {
  const wasRunning = runningJob === job
  settleJob(job, null)
  // A synchronous lexer cannot observe an abort message while it is working.
  // Stop that worker so a superseding document does not wait for discarded work.
  if (wasRunning) stopWorker()
}

function findOrCreateJob(filePath: string, source: string) {
  for (const job of jobs) {
    if (job.filePath === filePath && job.source === source) return job
  }

  for (const job of [...jobs]) {
    if (job.consumers.size === 0) discardJob(job)
  }
  if (jobs.size >= MAX_PENDING_JOBS) return null

  const job: TokenJob = {
    requestId: ++nextRequestId,
    filePath,
    source,
    startedAt: performance.now(),
    consumers: new Set(),
  }
  jobs.add(job)
  queue.push(job)
  return job
}

export function warmMarkdownLexerWorker() {
  ensureWorker()
}

export function prefetchMarkdownTokens(filePath: string, markdown: string) {
  if (!markdown) return
  if (preparedFiles.get(filePath)?.source === markdown) return
  preparedFiles.delete(filePath)
  findOrCreateJob(filePath, markdown)
  dispatchNextJob()
}

export function prepareMarkdownTokens(
  filePath: string,
  markdown: string,
  signal?: AbortSignal,
): Promise<PreparedMarkdownTokens | null> {
  if (signal?.aborted) return Promise.reject(new DOMException('Markdown tokenization cancelled', 'AbortError'))
  if (!markdown) return Promise.resolve(null)
  const prepared = preparedFiles.get(filePath)
  if (prepared?.source === markdown) return Promise.resolve(prepared)
  preparedFiles.delete(filePath)
  const job = findOrCreateJob(filePath, markdown)
  if (!job) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      consumer.dispose()
      job.consumers.delete(consumer)
      reject(new DOMException('Markdown tokenization cancelled', 'AbortError'))
      if (job.consumers.size === 0 && jobs.has(job)) {
        discardJob(job)
        dispatchNextJob()
      }
    }
    const consumer: TokenConsumer = {
      resolve,
      dispose: () => signal?.removeEventListener('abort', onAbort),
    }
    job.consumers.add(consumer)
    signal?.addEventListener('abort', onAbort, { once: true })
    dispatchNextJob()
  })
}
