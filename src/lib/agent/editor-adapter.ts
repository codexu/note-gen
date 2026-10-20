import type { AgentChange } from './types'

export type EditorTransactionOperation =
  | {
      type: 'replace_lines'
      startLine: number
      endLine: number
      content: string
    }
  | {
      type: 'insert_after_line' | 'insert_before_line'
      line: number
      content: string
    }

export interface EditorTransactionInput {
  filePath: string
  version: number
  operations: EditorTransactionOperation[]
}

export type EditorTransactionPreparation =
  | {
      ok: true
      markdown: string
      orderedOperations: EditorTransactionOperation[]
    }
  | {
      ok: false
      error: string
    }

const MAX_EDITOR_TRANSACTION_OPERATIONS = 100

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function operationIndex(operation: EditorTransactionOperation) {
  if (operation.type === 'replace_lines') {
    return operation.startLine - 1
  }
  return operation.type === 'insert_before_line'
    ? operation.line - 1
    : operation.line
}

export function prepareEditorLineTransaction(
  markdown: string,
  inputOperations: unknown[]
): EditorTransactionPreparation {
  const totalLines = markdown.split('\n').length

  if (inputOperations.length === 0) {
    return { ok: false, error: 'operations 必须至少包含一个编辑操作。' }
  }
  if (inputOperations.length > MAX_EDITOR_TRANSACTION_OPERATIONS) {
    return {
      ok: false,
      error: `单次编辑最多允许 ${MAX_EDITOR_TRANSACTION_OPERATIONS} 个操作。`,
    }
  }

  const operations: EditorTransactionOperation[] = []
  const replacedRanges: Array<{ startLine: number; endLine: number }> = []
  const insertionBoundaries: number[] = []

  for (const [index, rawOperation] of inputOperations.entries()) {
    if (!rawOperation || typeof rawOperation !== 'object' || Array.isArray(rawOperation)) {
      return { ok: false, error: `第 ${index + 1} 个操作必须是对象。` }
    }

    const operation = rawOperation as Record<string, unknown>
    if (typeof operation.content !== 'string') {
      return { ok: false, error: `第 ${index + 1} 个操作缺少字符串 content。` }
    }

    if (operation.type === 'replace_lines') {
      if (!isInteger(operation.startLine) || !isInteger(operation.endLine)) {
        return { ok: false, error: `第 ${index + 1} 个 replace_lines 操作必须提供整数 startLine/endLine。` }
      }
      const startLine = operation.startLine
      const endLine = operation.endLine
      if (
        startLine < 1 ||
        endLine < startLine ||
        endLine > totalLines
      ) {
        return {
          ok: false,
          error: `第 ${index + 1} 个操作行号越界：${startLine}-${endLine}，文档共 ${totalLines} 行。`,
        }
      }

      const overlaps = replacedRanges.some((range) =>
        startLine <= range.endLine && endLine >= range.startLine
      )
      if (overlaps) {
        return { ok: false, error: `第 ${index + 1} 个操作与另一个替换范围重叠。` }
      }

      replacedRanges.push({ startLine, endLine })
      operations.push({
        type: 'replace_lines',
        startLine,
        endLine,
        content: operation.content,
      })
      continue
    }

    if (operation.type === 'insert_before_line' || operation.type === 'insert_after_line') {
      if (!isInteger(operation.line)) {
        return { ok: false, error: `第 ${index + 1} 个插入操作必须提供整数 line。` }
      }
      const lineIsValid = operation.type === 'insert_before_line'
        ? operation.line >= 1 && operation.line <= totalLines
        : operation.line >= 0 && operation.line <= totalLines
      if (!lineIsValid) {
        return {
          ok: false,
          error: `第 ${index + 1} 个插入操作行号越界：${operation.line}，文档共 ${totalLines} 行。`,
        }
      }

      const boundary = operation.type === 'insert_before_line'
        ? operation.line - 1
        : operation.line
      if (insertionBoundaries.includes(boundary)) {
        return { ok: false, error: `第 ${index + 1} 个操作与另一个插入操作使用了同一位置。` }
      }
      insertionBoundaries.push(boundary)
      operations.push({
        type: operation.type,
        line: operation.line,
        content: operation.content,
      })
      continue
    }

    return {
      ok: false,
      error: `第 ${index + 1} 个操作类型无效。editor_apply_transaction 只支持行级替换和插入。`,
    }
  }

  for (const boundary of insertionBoundaries) {
    const conflictsWithReplacement = replacedRanges.some((range) =>
      boundary >= range.startLine - 1 && boundary <= range.endLine
    )
    if (conflictsWithReplacement) {
      return { ok: false, error: '插入位置不能位于同一事务的替换范围内部或边界上。' }
    }
  }

  const orderedOperations = [...operations].sort((left, right) =>
    operationIndex(right) - operationIndex(left)
  )
  const lines = markdown.split('\n')

  for (const operation of orderedOperations) {
    const replacementLines = operation.content.split('\n')
    if (operation.type === 'replace_lines') {
      lines.splice(
        operation.startLine - 1,
        operation.endLine - operation.startLine + 1,
        ...replacementLines
      )
      continue
    }

    const insertionIndex = operation.type === 'insert_before_line'
      ? operation.line - 1
      : operation.line
    lines.splice(insertionIndex, 0, ...replacementLines)
  }

  return {
    ok: true,
    markdown: lines.join('\n'),
    orderedOperations,
  }
}

export function buildEditorChange(target: string, before: string | undefined, after: string | undefined): AgentChange {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'editor',
    target,
    before,
    after,
    reversible: true,
    summary: '编辑器内容已更新',
  }
}
