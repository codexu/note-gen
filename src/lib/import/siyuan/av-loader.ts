import { exists, lstat, readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import type { SyAttributeView } from './types'
import { SyImportBudgetExceededError, throwIfAborted } from './budgets.ts'

const MAX_ATTRIBUTE_VIEW_BYTES = 64 * 1024 * 1024
export const MAX_ATTRIBUTE_VIEW_FILES = 2_000
export const MAX_TOTAL_ATTRIBUTE_VIEW_BYTES = 256 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function hasOptionalType(
  value: Record<string, unknown>,
  key: string,
  type: 'boolean' | 'number' | 'string',
): boolean {
  return value[key] === undefined || typeof value[key] === type
}

function isRecordWithOptionalStringContent(value: unknown): boolean {
  return isRecord(value) && hasOptionalType(value, 'content', 'string')
}

function isValidAvContent(value: unknown): boolean {
  return isRecord(value)
    && hasOptionalType(value, 'id', 'string')
    && hasOptionalType(value, 'content', 'string')
}

function isValidAvNumber(value: unknown): boolean {
  return isRecord(value)
    && hasOptionalType(value, 'content', 'number')
    && hasOptionalType(value, 'formattedContent', 'string')
    && hasOptionalType(value, 'isNotEmpty', 'boolean')
}

function isValidAvDate(value: unknown): boolean {
  return isRecord(value)
    && hasOptionalType(value, 'content', 'number')
    && hasOptionalType(value, 'content2', 'number')
    && hasOptionalType(value, 'isNotTime', 'boolean')
    && hasOptionalType(value, 'hasEndDate', 'boolean')
    && hasOptionalType(value, 'formattedContent', 'string')
}

function isValidAvAsset(value: unknown): boolean {
  return isRecord(value)
    && hasOptionalType(value, 'name', 'string')
    && hasOptionalType(value, 'content', 'string')
}

function isValidAvRelationContent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }
  return (value.block === undefined || isRecordWithOptionalStringContent(value.block))
    && (value.text === undefined || isRecordWithOptionalStringContent(value.text))
}

function isValidAvRollupContent(value: unknown): boolean {
  if (!isValidAvRelationContent(value) || !isRecord(value)) {
    return false
  }
  return value.number === undefined || isValidAvNumber(value.number)
}

function isValidAvValue(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  if (
    !hasOptionalType(value, 'id', 'string')
    || !hasOptionalType(value, 'keyID', 'string')
    || !hasOptionalType(value, 'blockID', 'string')
    || !hasOptionalType(value, 'type', 'string')
  ) {
    return false
  }

  const optionalContentObjects = ['text', 'url', 'email', 'phone', 'template']
  if (optionalContentObjects.some(key =>
    value[key] !== undefined && !isRecordWithOptionalStringContent(value[key])
  )) {
    return false
  }

  if (
    (value.block !== undefined && !isValidAvContent(value.block))
    || (value.number !== undefined && !isValidAvNumber(value.number))
    || (value.date !== undefined && !isValidAvDate(value.date))
    || (value.mSelect !== undefined
      && (!Array.isArray(value.mSelect) || !value.mSelect.every(isRecordWithOptionalStringContent)))
    || (value.mAsset !== undefined
      && (!Array.isArray(value.mAsset) || !value.mAsset.every(isValidAvAsset)))
  ) {
    return false
  }

  for (const key of ['created', 'updated']) {
    const item = value[key]
    if (item !== undefined
      && (!isRecord(item) || !hasOptionalType(item, 'formattedContent', 'string'))) {
      return false
    }
  }

  if (value.checkbox !== undefined
    && (!isRecord(value.checkbox) || !hasOptionalType(value.checkbox, 'checked', 'boolean'))) {
    return false
  }

  if (value.relation !== undefined) {
    if (!isRecord(value.relation)) {
      return false
    }
    if (value.relation.blockIDs !== undefined
      && value.relation.blockIDs !== null
      && (!Array.isArray(value.relation.blockIDs)
        || !value.relation.blockIDs.every(item => typeof item === 'string'))) {
      return false
    }
    if (value.relation.contents !== undefined
      && value.relation.contents !== null
      && (!Array.isArray(value.relation.contents)
        || !value.relation.contents.every(isValidAvRelationContent))) {
      return false
    }
  }

  if (value.rollup !== undefined
    && (!isRecord(value.rollup)
      || (value.rollup.contents !== undefined
        && value.rollup.contents !== null
        && (!Array.isArray(value.rollup.contents)
          || !value.rollup.contents.every(isValidAvRollupContent))))) {
    return false
  }

  return true
}

function isValidAvKey(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  return isNonEmptyString(value.id)
    && typeof value.name === 'string'
    && typeof value.type === 'string'
}

function isValidAvKeyValue(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  if (!isValidAvKey(value.key)) {
    return false
  }

  if (value.values !== undefined) {
    if (!Array.isArray(value.values) || !value.values.every(isValidAvValue)) {
      return false
    }
  }

  return true
}

function isValidAvViewColumn(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  return isNonEmptyString(value.id)
    && hasOptionalType(value, 'hidden', 'boolean')
}

function isValidAvViewTable(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  if (value.columns !== undefined) {
    if (!Array.isArray(value.columns) || !value.columns.every(isValidAvViewColumn)) {
      return false
    }
  }

  if (value.rowIds !== undefined
    && (!Array.isArray(value.rowIds)
      || !value.rowIds.every(item => typeof item === 'string'))) {
    return false
  }

  return true
}

function isValidAvView(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  if (!isNonEmptyString(value.id)) {
    return false
  }

  if (value.itemIds !== undefined
    && (!Array.isArray(value.itemIds)
      || !value.itemIds.every(item => typeof item === 'string'))) {
    return false
  }

  if (value.table !== undefined && !isValidAvViewTable(value.table)) {
    return false
  }

  return true
}

export function isValidAttributeView(value: unknown): value is SyAttributeView {
  if (!isRecord(value)) {
    return false
  }

  if (!isNonEmptyString(value.id)) {
    return false
  }

  if (
    !hasOptionalType(value, 'spec', 'number')
    || !hasOptionalType(value, 'name', 'string')
    || !hasOptionalType(value, 'viewID', 'string')
  ) {
    return false
  }

  if (value.keyValues !== undefined) {
    if (!Array.isArray(value.keyValues) || !value.keyValues.every(isValidAvKeyValue)) {
      return false
    }
  }

  if (value.keyIDs !== undefined && value.keyIDs !== null) {
    if (!Array.isArray(value.keyIDs)
      || !value.keyIDs.every(item => typeof item === 'string')) {
      return false
    }
  }

  if (value.views !== undefined) {
    if (!Array.isArray(value.views) || !value.views.every(isValidAvView)) {
      return false
    }
  }

  return true
}

async function readJsonFiles(
  directory: string,
  signal?: AbortSignal,
  budget?: { fileCount: number; totalBytes: number },
): Promise<Array<{ id: string; data: SyAttributeView }>> {
  if (!await exists(directory)) {
    return []
  }

  const entries = await readDir(directory)
  const results: Array<{ id: string; data: SyAttributeView }> = []

  for (const entry of entries) {
    throwIfAborted(signal)
    if (!entry.isFile || entry.isSymlink || !entry.name.endsWith('.json')) {
      continue
    }

    if (budget) {
      budget.fileCount += 1
      if (budget.fileCount > MAX_ATTRIBUTE_VIEW_FILES) {
        throw new SyImportBudgetExceededError(
          `SiYuan import exceeds the attribute-view file limit (${MAX_ATTRIBUTE_VIEW_FILES}).`,
        )
      }
    }

    const id = entry.name.replace(/\.json$/, '')
    try {
      const filePath = await join(directory, entry.name)
      const fileInfo = await lstat(filePath)
      if (!fileInfo.isFile || fileInfo.isSymlink || fileInfo.size > MAX_ATTRIBUTE_VIEW_BYTES) {
        continue
      }

      if (budget) {
        budget.totalBytes += fileInfo.size
        if (budget.totalBytes > MAX_TOTAL_ATTRIBUTE_VIEW_BYTES) {
          throw new SyImportBudgetExceededError(
            `SiYuan import exceeds the attribute-view memory budget (${MAX_TOTAL_ATTRIBUTE_VIEW_BYTES} bytes).`,
          )
        }
      }

      const content = await readTextFile(filePath)
      const parsed: unknown = JSON.parse(content)
      if (!isValidAttributeView(parsed)) {
        continue
      }
      results.push({ id, data: parsed })
    } catch (error) {
      if (error instanceof SyImportBudgetExceededError) {
        throw error
      }
      continue
    }
  }

  return results
}

async function mergeAttributeViewsFromDir(
  directory: string,
  attributeViews: Map<string, SyAttributeView>,
  signal?: AbortSignal,
  budget?: { fileCount: number; totalBytes: number },
): Promise<void> {
  const files = await readJsonFiles(directory, signal, budget)
  for (const file of files) {
    throwIfAborted(signal)
    attributeViews.set(file.data.id ?? file.id, file.data)
  }
}

async function resolveDirectoryUnderRoot(root: string, segments: string[]): Promise<string | null> {
  let currentPath = root

  for (const segment of segments) {
    currentPath = await join(currentPath, segment)
    if (!await exists(currentPath)) {
      return null
    }

    const pathInfo = await lstat(currentPath)
    if (!pathInfo.isDirectory || pathInfo.isSymlink) {
      return null
    }
  }

  return currentPath
}

export async function loadAttributeViews(
  dataRoot: string,
  signal?: AbortSignal,
): Promise<Map<string, SyAttributeView>> {
  const attributeViews = new Map<string, SyAttributeView>()
  const budget = { fileCount: 0, totalBytes: 0 }
  const rootAvDirectory = await resolveDirectoryUnderRoot(dataRoot, ['storage', 'av'])
  if (rootAvDirectory) {
    await mergeAttributeViewsFromDir(rootAvDirectory, attributeViews, signal, budget)
  }

  const entries = await readDir(dataRoot)
  for (const entry of entries) {
    throwIfAborted(signal)
    if (entry.name.startsWith('.') || !entry.isDirectory || entry.isSymlink) {
      continue
    }

    const notebookAvDirectory = await resolveDirectoryUnderRoot(
      dataRoot,
      [entry.name, 'storage', 'av'],
    )
    if (notebookAvDirectory) {
      await mergeAttributeViewsFromDir(notebookAvDirectory, attributeViews, signal, budget)
    }
  }

  return attributeViews
}
