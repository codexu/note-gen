'use client'

import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { revealInFileTree } from '@/lib/daily/note-io'
import { noteKeyOf } from '@/lib/markdown/wikilink'
import {
  collectNotesForTag,
  filterTagTree,
  normalizeTag,
  sortTagTree,
  type TagNode,
} from '@/lib/vault-index/tags'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useVaultIndexStore, { selectTagTree } from '@/stores/vault-index'

export type TagSortMode = 'name' | 'count'

/**
 * 沒有搜尋時沿用手動展開。
 * 有搜尋時打開過濾後仍看得到子節點的節點，命中項的祖先就會展開。
 */
export function expandedPathsForQuery(tree: TagNode[], query: string, userExpanded: ReadonlySet<string>): Set<string> {
  if (!normalizeTag(query)) return new Set(userExpanded)
  const expanded = new Set<string>()
  const walk = (nodes: TagNode[]) => {
    for (const node of nodes) {
      if (node.children.length === 0) continue
      expanded.add(node.fullPath)
      walk(node.children)
    }
  }
  walk(filterTagTree(tree, query))
  return expanded
}

/** 切換手動展開，不改動原本的 Set。 */
export function toggleExpanded(current: ReadonlySet<string>, fullPath: string): Set<string> {
  const next = new Set(current)
  if (next.has(fullPath)) next.delete(fullPath)
  else next.add(fullPath)
  return next
}

function findTagLabel(nodes: TagNode[], fullPath: string, prefix = ''): string | null {
  for (const node of nodes) {
    const label = prefix ? `${prefix}/${node.name}` : node.name
    if (node.fullPath === fullPath) return label
    const nested = findTagLabel(node.children, fullPath, label)
    if (nested) return nested
  }
  return null
}

function TagTree({
  nodes,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  nodes: TagNode[]
  depth: number
  expanded: ReadonlySet<string>
  selected: string | null
  onToggle: (fullPath: string) => void
  onSelect: (fullPath: string) => void
}) {
  return nodes.map(node => {
    const hasChildren = node.children.length > 0
    const isExpanded = hasChildren && expanded.has(node.fullPath)
    const isSelected = selected === node.fullPath
    return (
      <div
        key={node.fullPath}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        data-tag={node.fullPath}
      >
        <div className="flex items-center gap-0.5 rounded" style={{ paddingInlineStart: depth * 16 }}>
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-label={node.name}
              onClick={() => onToggle(node.fullPath)}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ink"
            >
              <ChevronRight className={cn('size-3.5 transition-transform duration-150', isExpanded && 'rotate-90')} />
            </button>
          ) : (
            <span className="size-5 shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => onSelect(node.fullPath)}
            className={cn(
              'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ink',
              isSelected && 'bg-active text-ink font-medium',
            )}
          >
            <span className="truncate [overflow-wrap:anywhere]">{node.name}</span>
            <span className="ml-auto shrink-0 text-ink font-medium">{node.count}</span>
          </button>
        </div>
        {isExpanded && (
          <div role="group">
            <TagTree
              nodes={node.children}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          </div>
        )}
      </div>
    )
  })
}

export default function NoteTagsSidebar() {
  const t = useTranslations('noteTags')
  const status = useVaultIndexStore(state => state.status)
  const notes = useVaultIndexStore(state => state.notes)
  const tree = useVaultIndexStore(selectTagTree)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<TagSortMode>('name')
  const [userExpanded, setUserExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const sorted = useMemo(() => sortTagTree(tree, sortBy), [tree, sortBy])
  const filtered = useMemo(() => filterTagTree(sorted, query), [sorted, query])
  const expanded = useMemo(
    () => expandedPathsForQuery(sorted, query, userExpanded),
    [sorted, query, userExpanded],
  )
  const selectedLabel = selected ? findTagLabel(tree, selected) : null
  const notePaths = useMemo(
    () => (selected && selectedLabel ? collectNotesForTag(selected, notes.values()) : []),
    [notes, selected, selectedLabel],
  )
  const queryActive = normalizeTag(query).length > 0

  async function openNote(path: string) {
    await revealInFileTree(path)
    await useArticleStore.getState().setActiveFilePath(path)
  }

  return (
    <aside aria-label={t('title')} className="h-full overflow-y-auto p-3 text-sm">
      {status !== 'ready' ? <p role="status" className="py-4 text-muted-foreground">{t('indexing')}</p>
        : tree.length === 0 ? <p className="py-4 text-muted-foreground">{t('empty')}</p>
          : <>
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="mb-2"
            />
            <div className="mb-3 flex gap-1">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-pressed={sortBy === 'name'}
                className={cn(sortBy === 'name' && 'bg-active text-ink font-medium hover:bg-active')}
                onClick={() => setSortBy('name')}
              >
                {t('sortByName')}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-pressed={sortBy === 'count'}
                className={cn(sortBy === 'count' && 'bg-active text-ink font-medium hover:bg-active')}
                onClick={() => setSortBy('count')}
              >
                {t('sortByCount')}
              </Button>
            </div>
            <div role="tree" aria-label={t('title')}>
              <TagTree
                nodes={filtered}
                depth={0}
                expanded={expanded}
                selected={selected}
                onToggle={fullPath => {
                  if (queryActive) return
                  setUserExpanded(current => toggleExpanded(current, fullPath))
                }}
                onSelect={setSelected}
              />
            </div>
            {selectedLabel && (
              <section aria-label={selectedLabel} className="mt-4 border-t pt-3">
                <h2 className="mb-3 font-semibold">
                  {selectedLabel} <span className="text-ink font-medium">{t('notes', { count: notePaths.length })}</span>
                </h2>
                <ul className="grid gap-1">
                  {notePaths.map(path => {
                    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
                    return (
                      <li key={path}>
                        <button
                          type="button"
                          onClick={() => void openNote(path)}
                          className="w-full cursor-pointer rounded p-2 text-left [overflow-wrap:anywhere] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ink"
                        >
                          <span className="font-medium">{noteKeyOf(path)}</span>
                          {folder && <span className="mt-0.5 block text-xs text-muted-foreground">{folder}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </>}
    </aside>
  )
}
