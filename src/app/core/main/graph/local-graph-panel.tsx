'use client'

import { useEffect, useMemo, useState } from 'react'
import { ReactFlow, MarkerType, Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import useArticleStore from '@/stores/article'
import useVaultIndexStore from '@/stores/vault-index'
import { revealInFileTree } from '@/lib/daily/note-io'
import { buildLocalGraph, layoutLocalGraph, graphFolder, type GraphNode } from '@/lib/vault-index/graph'

export function graphNodeClass(node: GraphNode, centerPath: string): string {
  if (node.distance === 0) return 'border-invert bg-invert text-invert-ink'
  if (node.path === null) return 'border-dashed border-muted-foreground/40 bg-background text-muted-foreground'
  return node.folder === graphFolder(centerPath) ? 'border-line bg-hover text-ink' : 'border-border bg-background text-foreground'
}
export function graphTruncationKey(truncated: boolean): 'truncated' | null { return truncated ? 'truncated' : null }
type NoteNode = Node<{ label: string; title: string; className: string }, 'note'>
function GraphNote({ data }: NodeProps<NoteNode>) {
  return <div title={data.title} className={'flex h-12 w-40 items-center justify-center rounded-lg border px-2 text-center text-xs ' + data.className}>
    <Handle type="target" position={Position.Top} className="opacity-0" />
    <span className="truncate">{data.label}</span>
    <Handle type="source" position={Position.Bottom} className="opacity-0" />
  </div>
}
const nodeTypes = { note: GraphNote }
function FitGraph({ nodes }: { nodes: NoteNode[] }) {
  const { fitView } = useReactFlow()
  useEffect(() => { void fitView({ padding: 0.2 }) }, [nodes, fitView])
  return null
}

export default function LocalGraphPanel() {
  const t = useTranslations('localGraph')
  const path = useArticleStore(state => state.activeFilePath) ?? ''
  const status = useVaultIndexStore(state => state.status)
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const [depth, setDepth] = useState<1 | 2>(1)
  const graph = useMemo(() => buildLocalGraph(path, notes.values(), { depth }), [path, notes, revision, depth])
  const [positioned, setPositioned] = useState<{ graph: typeof graph; positions: Map<string, { x: number; y: number }> } | null>(null)
  useEffect(() => {
    if (status !== 'ready' || !/\.md$/i.test(path) || graph.edges.length === 0) return
    let cancelled = false
    layoutLocalGraph(graph).then(positions => { if (!cancelled) setPositioned({ graph, positions }) })
      .catch(error => {
        console.error('關聯圖佈局失敗：', error)
        // 佈局失敗仍提供可點擊的筆記，避免面板永久停在載入狀態。
        if (!cancelled) setPositioned({ graph, positions: new Map(graph.nodes.map((node, i) => [node.id, { x: (i % 3) * 200, y: Math.floor(i / 3) * 100 }])) })
      })
    return () => { cancelled = true }
  }, [graph, status, path])
  const ready = positioned?.graph === graph
  const flowNodes: NoteNode[] = ready ? graph.nodes.map(node => ({ id: node.id, type: 'note', position: positioned.positions.get(node.id) ?? { x: 0, y: 0 },
    data: { label: node.label, title: node.path ?? node.label + ' — ' + t('unresolved'), className: graphNodeClass(node, path) } })) : []
  const edges = graph.edges.map((edge, i) => ({ ...edge, id: String(i), markerEnd: { type: MarkerType.ArrowClosed } }))
  const truncation = graphTruncationKey(graph.truncated)
  return <aside aria-label={t('title')} className="flex h-full min-h-0 flex-col text-sm">
    <div className="flex gap-1 border-b p-2">{([1, 2] as const).map(value => <Button key={value} size="sm" variant={depth === value ? 'secondary' : 'ghost'} aria-pressed={depth === value} onClick={() => setDepth(value)}>{t(value === 1 ? 'depth1' : 'depth2')}</Button>)}</div>
    {!/\.md$/i.test(path) ? <p className="p-3 text-muted-foreground">{t('notMarkdown')}</p>
      : status !== 'ready' ? <p role="status" className="p-3 text-muted-foreground">{t('indexing')}</p>
        : graph.edges.length === 0 ? <p className="p-3 text-muted-foreground">{t('empty')}</p>
          : <>{truncation && <p role="status" className="p-3 text-muted-foreground">{t(truncation, { count: graph.nodes.length })}</p>}
            <div className="min-h-0 flex-1"><ReactFlow nodes={flowNodes} edges={ready ? edges : []} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} elementsSelectable={false} deleteKeyCode={null} fitView minZoom={0.05}
              onNodeClick={async (_, node) => {
                const target = graph.nodes.find(item => item.id === node.id)?.path
                if (target) {
                  try { await revealInFileTree(target); await useArticleStore.getState().setActiveFilePath(target) }
                  catch (error) { console.error('關聯圖開啟筆記失敗：', error) }
                }
              }}><FitGraph nodes={flowNodes} /></ReactFlow></div></>}
  </aside>
}
