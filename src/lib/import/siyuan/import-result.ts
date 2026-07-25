import { summarizeImportReports, summarizeDegradedIssuesByCode } from './scan-import-issues.ts'
import type { SyImportDocumentReport, SyImportResult } from './types.ts'

export const MAX_RESULT_DOCUMENT_REPORTS = 500

export function buildImportResult(
  documentReports: SyImportDocumentReport[],
  assetCount: number,
  notebookCount: number,
  discoveredDocumentCount: number,
): SyImportResult {
  const summary = summarizeImportReports(documentReports)
  const issueDocuments = documentReports.filter(document => document.status !== 'success')
  const documentsTruncated = issueDocuments.length > MAX_RESULT_DOCUMENT_REPORTS
  const totalDocuments = documentReports.length
  const omittedDocumentCount = Math.max(0, discoveredDocumentCount - totalDocuments)

  return {
    totalDocuments,
    documentCount: totalDocuments,
    discoveredDocumentCount,
    omittedDocumentCount,
    assetCount,
    notebookCount,
    documents: issueDocuments.slice(0, MAX_RESULT_DOCUMENT_REPORTS),
    documentsTruncated,
    degradedIssuesSummary: summarizeDegradedIssuesByCode(documentReports),
    ...summary,
  }
}
