import type { WebSearchResponse } from '@/lib/web-search/types'
import { normalizeWebSearchSourceUrl } from '@/lib/web-search/source-url'
import type { AgentToolResult } from './types'

const MAX_WEB_SEARCH_CALLS = 3

function normalizeEvidenceText(value: string | undefined) {
  return value?.replace(/\s+/g, ' ').trim().toLowerCase() || ''
}

function getSearchEvidence(result: AgentToolResult) {
  if (!result.ok || !result.data || typeof result.data !== 'object') return []
  const data = result.data as Partial<WebSearchResponse>
  const evidence: string[] = []

  for (const source of data.sources || []) {
    const url = normalizeWebSearchSourceUrl(source.url)
    if (!url) continue
    // The same URL may provide new details or an updated forecast in a later query.
    evidence.push(`web-source:${JSON.stringify([
      url,
      normalizeEvidenceText(source.title),
      normalizeEvidenceText(source.snippet),
      normalizeEvidenceText(source.publishedAt),
    ])}`)
  }

  const answer = normalizeEvidenceText(data.answer)
  if (answer) evidence.push(`web-answer:${answer}`)
  return evidence
}

/** Per-run state, independent of model rounds, query wording, and history pruning. */
export class WebSearchBudget {
  private searchCount = 0
  private repeatedEvidence = false
  private readonly evidence = new Set<string>()

  get canSearch() {
    return this.searchCount < MAX_WEB_SEARCH_CALLS && !this.repeatedEvidence
  }

  get evidenceKeys(): Iterable<string> {
    return this.evidence
  }

  private get stopReason() {
    return this.repeatedEvidence
      ? '连续搜索没有获得新的来源内容，已停止重复搜索。'
      : `本次任务已达到 ${MAX_WEB_SEARCH_CALLS} 次联网搜索上限。`
  }

  startSearch(): AgentToolResult | undefined {
    if (!this.canSearch) {
      return {
        ok: false,
        message: `${this.stopReason} 请使用已有证据回答；如需补充细节，可以读取已找到的网页，并如实说明仍缺失的信息。`,
        error: this.repeatedEvidence ? 'WEB_SEARCH_NO_NEW_EVIDENCE' : 'WEB_SEARCH_BUDGET_EXHAUSTED',
      }
    }

    // Count attempts before execution, including failures and calls in the same batch.
    this.searchCount += 1
    return undefined
  }

  recordResult(result: AgentToolResult) {
    if (!result.ok) return
    const previousSize = this.evidence.size
    for (const key of getSearchEvidence(result)) this.evidence.add(key)
    if (previousSize > 0 && this.evidence.size === previousSize) {
      this.repeatedEvidence = true
    }
  }

  formatInstructions() {
    return [
      '## Web Search Budget',
      `This run has used ${this.searchCount} of at most ${MAX_WEB_SEARCH_CALLS} web_search calls. Failed searches also consume this budget. It is a ceiling, not a target.`,
      this.canSearch
        ? `${MAX_WEB_SEARCH_CALLS - this.searchCount} searches remain. Evaluate the complete batch and stop as soon as the evidence answers the question. Search again only for a concrete missing, outdated, or conflicting fact. Use sources[].providers to exclude a specific engine returning unrelated results; do not automatically exclude every engine in an aggregated response or just reword the query.`
        : `web_search is no longer available: ${this.stopReason} Use the evidence already collected. Before reporting that information is unavailable, use web_read_page if an existing relevant result could fill the gap; skip unrelated pages. Other tools needed to complete the user's task remain available. Do not use other tools to bypass the search limit. State unresolved gaps honestly instead of inventing facts.`,
    ].join('\n')
  }
}
