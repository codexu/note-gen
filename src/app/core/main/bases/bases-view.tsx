'use client'

// Fork (Phase 2-3b, 軌道 A)：Bases 結果的共用渲染，`.base` 整頁與筆記內 ```base 區塊都用這個。
// - 訂閱 vault 索引（notes／revision），revision 變動即時重算（useMemo）。
// - 多個 view 時上方有 tab 切換；table 表頭可點排序（只覆蓋記憶體，不寫回檔案）。
// - `file.name` 欄顯示為連結（點開筆記）；frontmatter 的 `"[[X]]"` 字串也可點（照 wikilink 規則開啟）。
// - 日期 `YYYY-MM-DD`、清單 chip、布林 ✓／空白；錯誤格顯示「⚠ 運算式錯誤：…」。
// - 不支援的 view 型別（cards／kanban…）顯示提示並以 table 呈現。

import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { revealInFileTree } from '@/lib/daily/note-io'
import { parseWikilink } from '@/lib/markdown/wikilink'
import type { BaseFile, BaseParseError } from '@/lib/bases/format'
import { evaluateBaseView, makeIndexResolver, type ViewResult } from '@/lib/bases/evaluate'
import useArticleStore from '@/stores/article'
import useVaultIndexStore from '@/stores/vault-index'
import { openWikilink } from '@/app/core/main/editor/markdown/wikilink-extension'
import {
  type CellDisplay,
  clampViewIndex,
  describeCell,
  effectiveSort,
  nextSortOverride,
  sortIndicator,
  type SortOverride,
} from './bases-view-model'

/** 在編輯器開啟 vault 內的筆記（與嵌入、wikilink 的做法相同）。 */
export async function openNoteFromBases(path: string): Promise<void> {
  await revealInFileTree(path)
  await useArticleStore.getState().setActiveFilePath(path)
}

function stop(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function CellContent({ display, exprErrorLabel }: { display: CellDisplay, exprErrorLabel: string }) {
  switch (display.kind) {
    case 'empty':
      return null
    case 'text':
      return <span className="whitespace-pre-wrap break-words">{display.text}</span>
    case 'bool':
      return display.value ? <span className="text-brand">✓</span> : null
    case 'note':
      return (
        <button
          type="button"
          className="text-left text-brand underline-offset-4 hover:underline"
          onClick={(event) => {
            stop(event)
            void openNoteFromBases(display.path).catch(error => console.error('[bases] open failed', error))
          }}
        >
          {display.label}
        </button>
      )
    case 'wikilink':
      return (
        <button
          type="button"
          className="text-left text-brand underline-offset-4 hover:underline"
          title={display.raw}
          onClick={(event) => {
            stop(event)
            const link = parseWikilink(display.raw)
            if (link) void openWikilink(link).catch(error => console.error('[bases] open failed', error))
          }}
        >
          {display.label}
        </button>
      )
    case 'chips':
      return (
        <span className="flex flex-wrap gap-1">
          {display.items.map((item, index) => (
            <Badge key={`${item}-${index}`} variant="secondary" className="h-auto whitespace-normal font-normal">{item}</Badge>
          ))}
        </span>
      )
    case 'error':
      return <span className="text-xs text-destructive" title={display.message}>⚠ {exprErrorLabel}{display.message}</span>
  }
}

interface ResultProps {
  result: ViewResult
  sort: ReturnType<typeof effectiveSort>
  onSort: (key: string) => void
  compact?: boolean
}

function TableResult({ result, sort, onSort, compact }: ResultProps) {
  const t = useTranslations('bases')
  const exprErrorLabel = t('exprError')
  return (
    <Table className={cn(compact && 'text-xs')}>
      <TableHeader>
        <TableRow>
          {result.columns.map(column => {
            const direction = sortIndicator(sort, column.key)
            return (
              <TableHead key={column.key} className="whitespace-nowrap">
                <button
                  type="button"
                  className={cn('inline-flex items-center gap-1 hover:text-foreground', direction && 'text-ink')}
                  onClick={(event) => { stop(event); onSort(column.key) }}
                  title={column.key}
                >
                  {column.label}
                  {direction === 'ASC' && <ArrowUp className="size-3" />}
                  {direction === 'DESC' && <ArrowDown className="size-3" />}
                </button>
              </TableHead>
            )
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {result.rows.map(row => (
          <TableRow key={row.path}>
            {result.columns.map(column => (
              <TableCell key={column.key} className="align-top">
                <CellContent display={describeCell(column.key, row.cells[column.key] ?? null, row)} exprErrorLabel={exprErrorLabel} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ListResult({ result, compact }: Omit<ResultProps, 'sort' | 'onSort'>) {
  const t = useTranslations('bases')
  const exprErrorLabel = t('exprError')
  const [first, ...rest] = result.columns
  return (
    <ul className={cn('divide-y', compact ? 'text-xs' : 'text-sm')}>
      {result.rows.map(row => (
        <li key={row.path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-1.5">
          <span className="font-medium">
            <CellContent display={first ? describeCell(first.key, row.cells[first.key] ?? null, row) : { kind: 'note', path: row.path, label: row.name }} exprErrorLabel={exprErrorLabel} />
          </span>
          {rest.map(column => {
            const display = describeCell(column.key, row.cells[column.key] ?? null, row)
            if (display.kind === 'empty') return null
            return (
              <span key={column.key} className="inline-flex items-baseline gap-1 text-muted-foreground">
                <span className="text-xs">{column.label}:</span>
                <CellContent display={display} exprErrorLabel={exprErrorLabel} />
              </span>
            )
          })}
        </li>
      ))}
    </ul>
  )
}

export interface BasesDocumentProps {
  base: BaseFile | null
  errors: BaseParseError[]
  /** 區塊內使用：字小一點、不顯示標題 */
  compact?: boolean
  className?: string
}

/** 解析後的 base → 評估 → 渲染（含 view 切換與排序覆蓋）。 */
export function BasesDocument({ base, errors, compact, className }: BasesDocumentProps) {
  const t = useTranslations('bases')
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const status = useVaultIndexStore(state => state.status)
  const [viewIndex, setViewIndex] = useState(0)
  const [overrides, setOverrides] = useState<Record<number, SortOverride>>({})

  const views = base?.views ?? []
  const activeIndex = clampViewIndex(views.length, viewIndex)
  const view = views[activeIndex]
  const override = overrides[activeIndex] ?? null

  // 對照表每個 revision 建一次；notes 參考變了就重建
  const resolve = useMemo(() => makeIndexResolver(notes.keys()), [notes, revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const result = useMemo<ViewResult | null>(() => {
    if (!base || !view) return null
    return evaluateBaseView({ base, notes: notes.values(), resolve, now: new Date() }, view, { sortOverride: override })
  }, [base, view, notes, revision, resolve, override]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = useCallback((key: string) => {
    setOverrides(current => ({ ...current, [activeIndex]: nextSortOverride(current[activeIndex] ?? null, key) }))
  }, [activeIndex])

  if (!base) {
    const first = errors[0]
    return (
      <div className={cn('rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive', className)}>
        {t('parseError', { message: first ? `${first.message}${first.line ? ` (line ${first.line})` : ''}` : '?' })}
      </div>
    )
  }

  const indexing = status === 'scanning' && notes.size === 0
  const sort = view ? effectiveSort(view, override) : []

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {views.length > 1 && (
        <Tabs value={String(activeIndex)} onValueChange={(value) => setViewIndex(Number(value))}>
          <TabsList variant="line" className="h-auto flex-wrap justify-start">
            {views.map((item, index) => (
              <TabsTrigger key={`${index}-${item.name}`} value={String(index)} className="flex-none">{item.name}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {errors.length > 0 && (
        <ul className="text-xs text-destructive">
          {errors.map((error, index) => <li key={index}>{t('parseError', { message: error.message })}</li>)}
        </ul>
      )}

      {result && !['table', 'list'].includes(result.requestedType) && (
        <p className="text-xs text-muted-foreground">{t('unsupportedView', { type: result.requestedType })}</p>
      )}

      {result && result.errors.length > 0 && (
        <details className="text-xs text-destructive">
          <summary className="cursor-pointer">⚠ {t('exprError')}{result.errors[0]}{result.errors.length > 1 ? ` (+${result.errors.length - 1})` : ''}</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {result.errors.slice(1).map((message, index) => <li key={index}>{message}</li>)}
          </ul>
        </details>
      )}

      {indexing ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{t('indexing')}</p>
      ) : !result || result.rows.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{t('empty')}</p>
      ) : result.type === 'list' ? (
        <ListResult result={result} compact={compact} />
      ) : (
        <TableResult result={result} sort={sort} onSort={handleSort} compact={compact} />
      )}

      {result?.truncated && (
        <p className="px-3 text-xs text-muted-foreground">{t('more', { count: result.total - result.rows.length })}</p>
      )}
    </div>
  )
}
