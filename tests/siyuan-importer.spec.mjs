import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ImportBudgetTracker,
  MAX_IMPORT_DOCUMENTS,
  SyImportAbortedError,
  SyImportBudgetExceededError,
  throwIfAborted,
} from '../src/lib/import/siyuan/budgets.ts'
import { resolveSiYuanArchiveRootFromEntries } from '../src/lib/import/siyuan/archive-root.ts'
import { buildImportResult, MAX_RESULT_DOCUMENT_REPORTS } from '../src/lib/import/siyuan/import-result.ts'

function createDocument(id, title = 'Imported note') {
  return {
    Type: 'NodeDocument',
    ID: id,
    Properties: { id, title },
    Children: [{ Type: 'NodeParagraph', Children: [{ Type: 'NodeText', Data: 'Body' }] }],
  }
}

test('throws when import abort signal is already aborted', () => {
  const controller = new AbortController()
  controller.abort()
  assert.throws(() => throwIfAborted(controller.signal), SyImportAbortedError)
})

test('enforces import document budget limits', () => {
  const budget = new ImportBudgetTracker()
  budget.documentCount = MAX_IMPORT_DOCUMENTS
  assert.throws(
    () => budget.trackDocument(createDocument('20260725000000-abcdefg'), 1024),
    SyImportBudgetExceededError,
  )
})

test('resolveSiYuanArchiveRootFromEntries accepts a single root directory entry', async () => {
  const tempRoot = '/tmp/extracted'
  const resolved = await resolveSiYuanArchiveRootFromEntries(
    [{ name: 'Security', isDirectory: true }],
    tempRoot,
    (base, segment) => `${base}/${segment}`,
  )
  assert.equal(resolved, '/tmp/extracted/Security')
})

test('resolveSiYuanArchiveRootFromEntries rejects archives with multiple root entries', async () => {
  await assert.rejects(
    () => resolveSiYuanArchiveRootFromEntries(
      [
        { name: 'a', isDirectory: true },
        { name: 'b', isDirectory: true },
      ],
      '/tmp/extracted',
      (base, segment) => `${base}/${segment}`,
    ),
    /expected one root directory/,
  )
})

test('buildImportResult keeps only non-success documents and caps IPC payload', () => {
  const reports = [
    { title: 'ok', syPath: '/a.sy', status: 'success', issues: [] },
    { title: 'bad', syPath: '/b.sy', status: 'failed', errorMessage: 'boom', issues: [] },
    ...Array.from({ length: MAX_RESULT_DOCUMENT_REPORTS + 5 }, (_, index) => ({
      title: `degraded-${index}`,
      syPath: `/d-${index}.sy`,
      status: 'degraded',
      issues: [{ level: 'degraded', code: 'widget', count: 1 }],
    })),
  ]

  const result = buildImportResult(reports, 3, 1, reports.length)
  assert.equal(result.totalDocuments, reports.length)
  assert.equal(result.discoveredDocumentCount, reports.length)
  assert.equal(result.omittedDocumentCount, 0)
  assert.equal(result.successCount, 1)
  assert.equal(result.failedCount, 1)
  assert.equal(result.degradedCount, MAX_RESULT_DOCUMENT_REPORTS + 5)
  assert.equal(result.documents.length, MAX_RESULT_DOCUMENT_REPORTS)
  assert.equal(result.documentsTruncated, true)
  assert.ok(result.documents.every(document => document.status !== 'success'))
  assert.deepEqual(result.degradedIssuesSummary, [
    { code: 'widget', count: MAX_RESULT_DOCUMENT_REPORTS + 5, omittedRows: undefined, omittedColumns: undefined },
  ])
})
