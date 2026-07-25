import type { SyDocument, SyNode } from './types.ts'

export const MAX_IMPORT_DOCUMENTS = 50_000
export const MAX_IMPORT_TOTAL_NODES = 5_000_000
export const MAX_IMPORT_TOTAL_DOCUMENT_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_AV_TABLE_ROWS = 5_000
export const MAX_AV_TABLE_COLUMNS = 100
export const MAX_AV_MARKDOWN_BYTES = 512 * 1024

export class SyImportAbortedError extends Error {
  constructor() {
    super('Import cancelled')
    this.name = 'SyImportAbortedError'
  }
}

export class SyImportBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyImportBudgetExceededError'
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SyImportAbortedError()
  }
}

function countNodes(nodes: SyNode[] | undefined): number {
  if (!nodes?.length) {
    return 0
  }

  let count = 0
  for (const node of nodes) {
    count += 1
    count += countNodes(node.Children)
  }
  return count
}

export function countDocumentNodes(document: SyDocument): number {
  return 1 + countNodes(document.Children)
}

export class ImportBudgetTracker {
  documentCount = 0
  totalNodes = 0
  totalDocumentBytes = 0

  trackDocument(document: SyDocument, byteSize: number): void {
    this.documentCount += 1
    this.totalNodes += countDocumentNodes(document)
    this.totalDocumentBytes += byteSize

    if (this.documentCount > MAX_IMPORT_DOCUMENTS) {
      throw new SyImportBudgetExceededError(
        `SiYuan import exceeds the document limit (${MAX_IMPORT_DOCUMENTS}).`,
      )
    }
    if (this.totalNodes > MAX_IMPORT_TOTAL_NODES) {
      throw new SyImportBudgetExceededError(
        `SiYuan import exceeds the block limit (${MAX_IMPORT_TOTAL_NODES}).`,
      )
    }
    if (this.totalDocumentBytes > MAX_IMPORT_TOTAL_DOCUMENT_BYTES) {
      throw new SyImportBudgetExceededError(
        `SiYuan import exceeds the in-memory document budget (${MAX_IMPORT_TOTAL_DOCUMENT_BYTES} bytes).`,
      )
    }
  }
}
