'use client'

import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, Handle, Position, NodeResizer, applyNodeChanges, applyEdgeChanges, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import MarkdownIt from 'markdown-it'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { readNote, revealInFileTree } from '@/lib/daily/note-io'
import { rewriteNote } from '@/lib/note-rewrite'
import { noteKeyOf } from '@/lib/markdown/wikilink'
import useArticleStore from '@/stores/article'
import { type Side, type CanvasDocument } from '@/lib/obsidian-canvas/format'
import { toFlow, fromFlow, canvasColor, type CanvasFlowNode } from '@/lib/obsidian-canvas/flow'
import { CanvasSession } from '@/lib/obsidian-canvas/session'

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false, typographer: false })
const Editing = createContext<(id: string, text: string) => void>(() => {})
const positions = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }
function CanvasCard({ data, selected }: NodeProps<CanvasFlowNode>) {
  const n = data.node, update = useContext(Editing), t = useTranslations('obsidianCanvas')
  const [editing, setEditing] = useState(false)
  const [preview, setPreview] = useState('')
  useEffect(() => {
    let cancelled = false
    if (n.type === 'file' && n.file) void readNote(n.file).then(text => { if (!cancelled) setPreview((text ?? '').slice(0, 300)) }).catch(() => { if (!cancelled) setPreview('') })
    return () => { cancelled = true }
  }, [n.type, n.file])
  const openFile = async () => {
    if (!n.file) return
    await revealInFileTree(n.file)
    await useArticleStore.getState().setActiveFilePath(n.file)
  }
  return <div className={'h-full w-full rounded-md border-2 p-3 text-sm ' + (n.type === 'group' ? 'bg-hover' : 'bg-background')} style={{ borderColor: canvasColor(n.color) }} onDoubleClick={() => {
    if (n.type === 'text') setEditing(true)
    if (n.type === 'file') void openFile().catch(console.error)
  }}>
    <NodeResizer isVisible={selected && !editing} minWidth={80} minHeight={50} />
    {Object.entries(positions).flatMap(([side, position]) => ['source', 'target'].map(kind => <Handle key={kind + side} type={kind as 'source' | 'target'} position={position} id={kind + '-' + side} style={{ [side === 'top' || side === 'bottom' ? 'left' : 'top']: kind === 'source' ? '45%' : '55%' }} />))}
    {n.type === 'text' && (editing ? <textarea aria-label={t('title')} autoFocus className="nodrag nowheel h-full w-full resize-none bg-background outline-none" value={n.text ?? ''} onKeyDown={e => e.stopPropagation()} onChange={e => update(n.id, e.target.value)} onBlur={() => setEditing(false)} /> : <div className="nowheel prose prose-sm dark:prose-invert h-full overflow-auto break-words" onClick={e => {
      const link = (e.target as HTMLElement).closest('a')
      if (link) { e.preventDefault(); const href = link.getAttribute('href'); if (href && /^https?:|^mailto:/i.test(href)) void openUrl(href).catch(console.error) }
    }} dangerouslySetInnerHTML={{ __html: markdown.render(n.text ?? '') }} />)}
    {n.type === 'file' && <div className="nowheel h-full overflow-auto"><div className="text-ink">{noteKeyOf(n.file ?? '')}</div><p className="whitespace-pre-wrap break-words text-muted-foreground">{preview}</p></div>}
    {n.type === 'link' && <button className="nodrag text-brand break-all underline" onClick={() => { if (n.url) void openUrl(n.url).catch(console.error) }}>{n.url}</button>}
    {n.type === 'group' && <span className="text-muted-foreground">{n.label || t('untitledGroup')}</span>}
  </div>
}
const nodeTypes = { canvas: CanvasCard }
function CanvasContent({ filePath, isActive = true }: { filePath: string; isActive?: boolean }) {
  const t = useTranslations('obsidianCanvas'), { toast } = useToast()
  const [, render] = useReducer(n => n + 1, 0)
  const [source, setSource] = useState(false)
  // t 與 toast 每次 render 可能是新函式，放進 ref 讓 session 只跟 filePath 綁定，否則會無限重建（Maximum update depth）
  const notifyRef = useRef({ t, toast }); notifyRef.current = { t, toast }
  const session = useMemo(() => new CanvasSession({ read: () => readNote(filePath), rewrite: async fn => { const result = await rewriteNote(filePath, fn); if (!result) throw new Error('externalChange') } }, render, () => notifyRef.current.toast({ title: notifyRef.current.t('externalChange'), variant: 'destructive' })), [filePath])
  useEffect(() => { if (isActive) void session.load() }, [session, isActive])
  useEffect(() => () => session.dispose(), [session])
  const doc = session.doc
  const flow = useMemo(() => doc ? toFlow(doc) : { nodes: [], edges: [] }, [doc])
  const [display, setDisplay] = useState(flow)
  useEffect(() => { setDisplay(flow) }, [flow])
  const edit = (next: CanvasDocument) => session.edit(next)
  // 選取狀態只有一個來源：xyflow 透過 onNodesChange／onEdgesChange 寫進 display 的 selected 旗標
  const selectedNodeIds = useMemo(() => new Set(display.nodes.filter(n => n.selected).map(n => n.id)), [display.nodes])
  const selectedEdgeIds = useMemo(() => new Set(display.edges.filter(e => e.selected).map(e => e.id)), [display.edges])
  const hasSelection = selectedNodeIds.size > 0 || selectedEdgeIds.size > 0
  const remove = () => {
    if (!doc) return
    const nodes = doc.nodes.filter(n => !selectedNodeIds.has(n.id))
    edit({ ...doc, nodes, edges: doc.edges.filter(e => !selectedEdgeIds.has(e.id) && nodes.some(n => n.id === e.fromNode) && nodes.some(n => n.id === e.toNode)) })
  }
  return <div className="flex h-full min-h-0 flex-col" aria-label={t('title')}>
    <div className="flex items-center gap-2 border-b p-2">
      <span className="mr-auto truncate text-sm">{filePath}</span>
      {doc && <><Button size="sm" variant="ghost" disabled={session.blocked} onClick={() => edit({ ...doc, nodes: [...doc.nodes, { id: crypto.randomUUID(), type: 'text', x: 0, y: 0, width: 260, height: 180, text: '', extra: {} }] })}>{t('addText')}</Button><Button size="sm" variant="ghost" disabled={session.blocked || !hasSelection} onClick={remove}>{t('delete')}</Button></>}
      <Button size="sm" variant="ghost" onClick={() => setSource(!source)}>{t('openAsText')}</Button>
    </div>
    {session.errors.length > 0 && <p role="alert" className="p-3 text-sm text-destructive">{t('parseError', { message: session.errors.join('; ') })}</p>}
    {session.blocked && <p role="alert" className="p-3 text-sm text-muted-foreground">{t('externalChange')}</p>}
    {source || !doc ? <><p className="px-3 text-sm text-muted-foreground">{t('readOnly')}</p><textarea aria-label={t('openAsText')} className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-xs" readOnly value={session.original} /></> : <Editing.Provider value={(id, text) => edit({ ...doc, nodes: doc.nodes.map(n => n.id === id ? { ...n, text } : n) })}>
      <div className="min-h-0 flex-1"><ReactFlow nodes={display.nodes} edges={display.edges} nodeTypes={nodeTypes} fitView minZoom={0.05} nodesDraggable={!session.blocked} nodesConnectable={!session.blocked} elementsSelectable={!session.blocked} edgesReconnectable={false} deleteKeyCode={null}
        onNodesChange={changes => {
          setDisplay(current => {
            const nodes = applyNodeChanges(changes, current.nodes)
            if (doc && !session.blocked && changes.some(c => c.type === 'position' || c.type === 'dimensions' && c.resizing)) edit(fromFlow(doc, nodes, current.edges))
            return { ...current, nodes }
          })
        }}
        onEdgesChange={changes => { setDisplay(current => ({ ...current, edges: applyEdgeChanges(changes, current.edges) })) }}
        onConnect={connection => {
          if (!connection.source || !connection.target || session.blocked) return
          edit({ ...doc, edges: [...doc.edges, { id: crypto.randomUUID(), fromNode: connection.source, toNode: connection.target, fromSide: connection.sourceHandle?.replace('source-', '') as Side, toSide: connection.targetHandle?.replace('target-', '') as 'top', toEnd: 'arrow', extra: {} }] })
        }}
        onKeyDown={e => { if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); remove() } }}>
        <Background /><Controls />
      </ReactFlow></div>
    </Editing.Provider>}
  </div>
}
export default function ObsidianCanvasPage(props: { filePath: string; isActive?: boolean }) {
  return <CanvasContent key={props.filePath} {...props} />
}
