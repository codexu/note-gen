'use client'

import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import Image from 'next/image'
import { Handle, NodeResizer, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertCircle,
  CheckSquare2,
  ExternalLink,
  FileText,
  ImageIcon,
  Mic,
  Paperclip,
  ScanLine,
  Square,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useTranslations } from 'next-intl'
import { BaseNode, BaseNodeContent } from '@/components/base-node'
import { Spinner } from '@/components/ui/spinner'
import { resolveCanvasChartAppearance } from '@/lib/canvas/chart-appearance'
import emitter from '@/lib/emitter'
import type { CanvasNodeData, CanvasNodeType } from '@/types/canvas'
import type { CanvasFlowchartNodeType } from '@/lib/canvas/shapes'
import useArticleStore from '@/stores/article'
import { useSidebarStore } from '@/stores/sidebar'
import { cn, convertImageByWorkspace } from '@/lib/utils'
import { CanvasChart } from './canvas-chart'
import { ImageViewer } from '@/components/image-viewer'

export type FlowCanvasNode = Node<CanvasNodeData, CanvasNodeType>

const ConnectionHandles = memo(function ConnectionHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
    </>
  )
})

function previewClassName(state?: CanvasNodeData['previewState']) {
  return cn(
    state === 'add' && 'border-primary bg-primary/5 ring-2 ring-primary/40',
    state === 'update' && 'border-primary ring-2 ring-primary/30',
    state === 'delete' && 'border-destructive bg-destructive/5 opacity-60 ring-2 ring-destructive/40'
  )
}

function nodeStyle(data: CanvasNodeData): CSSProperties | undefined {
  const { color, borderStyle, borderWidth, fillColor, fillStyle } = data
  if (!color && !borderStyle && !borderWidth && !fillColor && !fillStyle) return undefined
  return {
    ...(color ? {
      borderColor: color,
      boxShadow: color === 'transparent' ? 'none' : `0 0 0 1px ${color}20`,
    } : {}),
    ...(borderStyle ? { borderStyle } : {}),
    ...(borderWidth ? { borderWidth } : {}),
    ...(fillColor
      ? { backgroundColor: fillColor }
      : fillStyle === 'tint' && color
        ? { backgroundColor: `color-mix(in srgb, ${color} 12%, hsl(var(--card)))` }
        : {}),
  }
}

function svgShapeStyle(data: CanvasNodeData) {
  const fillColor = data.fillColor
  return {
    fill: fillColor === 'transparent'
      ? 'transparent'
      : fillColor || (data.fillStyle === 'tint' && data.color
        ? `color-mix(in srgb, ${data.color} 12%, hsl(var(--card)))`
        : undefined),
    stroke: data.color || undefined,
    strokeWidth: data.borderWidth || 1,
    strokeDasharray: data.borderStyle === 'dashed'
      ? '8 6'
      : data.borderStyle === 'dotted' ? '2 5' : undefined,
  }
}

const EditableLabel = memo(function EditableLabel({ id, value, className }: { id: string; value: string; className?: string }) {
  const { updateNodeData } = useReactFlow<FlowCanvasNode>()
  const [editing, setEditing] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) return
    editorRef.current?.focus()
    editorRef.current?.select()
  }, [editing])

  if (!editing) {
    return (
      <div
        className={cn('w-full cursor-text whitespace-pre-wrap break-words text-center', className)}
        onDoubleClick={(event) => {
          event.stopPropagation()
          setEditing(true)
        }}
        aria-label="Node label"
      >
        {value}
      </div>
    )
  }

  return (
    <textarea
      ref={editorRef}
      className={cn('nodrag nowheel max-h-full w-full resize-none overflow-hidden bg-transparent text-center outline-none', className)}
      rows={Math.max(1, value.split('\n').length)}
      value={value}
      onFocus={() => emitter.emit('canvas-history-checkpoint')}
      onBlur={() => setEditing(false)}
      onChange={event => updateNodeData(id, { label: event.target.value })}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setEditing(false)
        }
      }}
      onPointerDown={event => event.stopPropagation()}
      aria-label="Node label"
    />
  )
})

function FlowchartShapeNode({
  id,
  data,
  type,
  selected,
}: {
  id: string
  data: CanvasNodeData
  type: CanvasFlowchartNodeType
  selected: boolean
}) {
  const shapeStyle = svgShapeStyle(data)
  const shapeClassName = 'fill-card stroke-border'
  const style = {
    ...shapeStyle,
    vectorEffect: 'non-scaling-stroke',
  } as CSSProperties
  return (
    <div className={cn(
      'relative flex size-full min-h-14 min-w-16 items-center justify-center text-card-foreground drop-shadow-sm in-[.selected]:drop-shadow-md',
      data.locked && 'cursor-not-allowed',
      previewClassName(data.previewState)
    )}>
      <ConnectionHandles />
      <NodeResizer
        isVisible={selected && !data.locked}
        minWidth={type === 'connector' ? 48 : 96}
        minHeight={type === 'connector' ? 48 : 56}
        keepAspectRatio={type === 'connector'}
        onResizeStart={() => emitter.emit('canvas-history-checkpoint')}
      />
      <svg className="absolute inset-0 size-full overflow-visible" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
        {type === 'process' && (
          <rect className={shapeClassName} x="1" y="1" width="198" height="98" rx="8" style={style} />
        )}
        {type === 'decision' && (
          <polygon className={shapeClassName} points="100,1 199,50 100,99 1,50" style={style} />
        )}
        {type === 'terminator' && (
          <rect className={shapeClassName} x="1" y="1" width="198" height="98" rx="49" style={style} />
        )}
        {type === 'input-output' && (
          <polygon className={shapeClassName} points="24,1 199,1 176,99 1,99" style={style} />
        )}
        {type === 'document' && (
          <path className={shapeClassName} d="M1 1H199V80C160 60 132 100 99 81C65 61 35 100 1 82Z" style={style} />
        )}
        {type === 'multi-document' && (
          <>
            <path className={shapeClassName} d="M15 1H199V73C163 57 137 90 106 75C76 60 49 90 15 75Z" style={style} />
            <path className={shapeClassName} d="M8 9H192V81C156 65 130 98 99 83C69 68 42 98 8 83Z" style={style} />
            <path className={shapeClassName} d="M1 17H185V89C149 73 123 106 92 91C62 76 35 106 1 91Z" style={style} />
          </>
        )}
        {type === 'predefined-process' && (
          <>
            <rect className={shapeClassName} x="1" y="1" width="198" height="98" rx="6" style={style} />
            <path className="fill-none stroke-border" d="M24 1V99M176 1V99" style={style} />
          </>
        )}
        {type === 'manual-input' && (
          <polygon className={shapeClassName} points="1,25 199,1 199,99 1,99" style={style} />
        )}
        {type === 'preparation' && (
          <polygon className={shapeClassName} points="28,1 172,1 199,50 172,99 28,99 1,50" style={style} />
        )}
        {type === 'delay' && (
          <path className={shapeClassName} d="M1 1H126C167 1 199 23 199 50S167 99 126 99H1Z" style={style} />
        )}
        {type === 'display' && (
          <path className={shapeClassName} d="M25 1H132C174 1 199 23 199 50S174 99 132 99H25C43 75 43 25 25 1Z" style={style} />
        )}
        {type === 'connector' && (
          <ellipse className={shapeClassName} cx="100" cy="50" rx="49" ry="49" style={style} />
        )}
        {type === 'off-page-connector' && (
          <polygon className={shapeClassName} points="1,1 199,1 199,66 100,99 1,66" style={style} />
        )}
        {type === 'internal-storage' && (
          <>
            <rect className={shapeClassName} x="1" y="1" width="198" height="98" rx="4" style={style} />
            <path className="fill-none stroke-border" d="M28 1V99M1 24H199" style={style} />
          </>
        )}
        {type === 'database' && (
          <>
            <path className={shapeClassName} d="M1 17C1 8 45 1 100 1S199 8 199 17V83C199 92 155 99 100 99S1 92 1 83Z" style={style} />
            <ellipse
              className="fill-none stroke-border"
              cx="100"
              cy="17"
              rx="99"
              ry="16"
              style={{
                stroke: shapeStyle.stroke,
                strokeWidth: shapeStyle.strokeWidth,
                strokeDasharray: shapeStyle.strokeDasharray,
                vectorEffect: 'non-scaling-stroke',
              }}
            />
          </>
        )}
        {type === 'stored-data' && (
          <path className={shapeClassName} d="M24 1H176C207 20 207 80 176 99H24C-7 80-7 20 24 1Z" style={style} />
        )}
      </svg>
      <EditableLabel
        id={id}
        value={data.label || ''}
        className={cn('relative max-w-[72%] px-2 text-sm', type === 'connector' && 'max-w-[64%] text-xs')}
      />
    </div>
  )
}

export const ProcessNode = memo(function ProcessNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="process" />
})

export const DecisionNode = memo(function DecisionNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="decision" />
})

export const TerminatorNode = memo(function TerminatorNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="terminator" />
})

export const InputOutputNode = memo(function InputOutputNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="input-output" />
})

export const DocumentNode = memo(function DocumentNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="document" />
})

export const MultiDocumentNode = memo(function MultiDocumentNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="multi-document" />
})

export const DatabaseNode = memo(function DatabaseNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="database" />
})

export const PredefinedProcessNode = memo(function PredefinedProcessNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="predefined-process" />
})

export const ManualInputNode = memo(function ManualInputNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="manual-input" />
})

export const PreparationNode = memo(function PreparationNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="preparation" />
})

export const DelayNode = memo(function DelayNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="delay" />
})

export const DisplayNode = memo(function DisplayNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="display" />
})

export const ConnectorNode = memo(function ConnectorNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="connector" />
})

export const OffPageConnectorNode = memo(function OffPageConnectorNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="off-page-connector" />
})

export const InternalStorageNode = memo(function InternalStorageNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="internal-storage" />
})

export const StoredDataNode = memo(function StoredDataNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return <FlowchartShapeNode id={id} data={data} selected={selected} type="stored-data" />
})

export const TextCanvasNode = memo(function TextCanvasNode({ id, data }: NodeProps<FlowCanvasNode>) {
  return (
    <div style={data.color && data.color !== 'transparent' ? { color: data.color } : undefined} className={cn('min-w-24 rounded-md px-2 py-1 text-sm text-foreground in-[.selected]:ring-1 in-[.selected]:ring-ring', previewClassName(data.previewState))}>
      <EditableLabel id={id} value={data.label ?? '文本'} />
    </div>
  )
})

export const NoteCanvasNode = memo(function NoteCanvasNode({ data }: NodeProps<FlowCanvasNode>) {
  const filePath = data.filePath || ''
  const openNote = async () => {
    if (!filePath) return
    await useSidebarStore.getState().setLeftSidebarTab('files')
    await useArticleStore.getState().setActiveFilePath(filePath)
  }

  return (
    <BaseNode
      style={nodeStyle(data)}
      className={cn('min-w-52 max-w-72 shadow-sm', previewClassName(data.previewState))}
      onDoubleClick={() => void openNote()}
    >
      <ConnectionHandles />
      <BaseNodeContent className="gap-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{data.label || filePath.split('/').pop() || '笔记'}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">{filePath}</span>
      </BaseNodeContent>
    </BaseNode>
  )
})

export const RecordCanvasNode = memo(function RecordCanvasNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  const t = useTranslations('record.mark.type')
  const { updateNodeData } = useReactFlow<FlowCanvasNode>()
  const recordType = data.recordType || 'text'
  const isImageRecord = recordType === 'image' || recordType === 'scan'
  const RecordIcon = recordType === 'recording'
    ? Mic
    : recordType === 'scan'
      ? ScanLine
      : recordType === 'image'
        ? ImageIcon
        : recordType === 'link'
          ? ExternalLink
          : recordType === 'file'
            ? Paperclip
            : recordType === 'todo'
              ? (data.checked ? CheckSquare2 : Square)
              : FileText

  const title = (
    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
      {recordType === 'todo' ? (
        <button
          type="button"
          className="nodrag shrink-0 text-muted-foreground"
          onClick={() => updateNodeData(id, { checked: !data.checked })}
          aria-label={data.checked ? 'Mark incomplete' : 'Mark complete'}
        >
          <RecordIcon className="size-4" />
        </button>
      ) : (
        <RecordIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <EditableLabel
        id={id}
        value={data.label ?? t(recordType)}
        className={cn('min-w-0 text-left', recordType === 'todo' && data.checked && 'text-muted-foreground line-through')}
      />
    </span>
  )

  return (
    <div className="relative size-full">
      <NodeResizer
        isVisible={selected && !data.locked}
        minWidth={200}
        minHeight={isImageRecord ? 140 : 88}
        onResizeStart={() => emitter.emit('canvas-history-checkpoint')}
      />
      <ConnectionHandles />
      <BaseNode
        style={nodeStyle(data)}
        className={cn('flex size-full flex-col overflow-hidden shadow-sm', previewClassName(data.previewState))}
        onDoubleClick={() => {
          if (recordType === 'link' && data.url) void openUrl(data.url)
        }}
      >
        {isImageRecord && data.url ? (
          <>
            <div className="min-h-0 flex-1 overflow-hidden bg-muted">
              <ImageViewer
                url={data.url}
                path={recordType === 'scan' ? 'screenshot' : 'image'}
                imageClassName="size-full object-cover"
                interactive={false}
              />
            </div>
            <BaseNodeContent className="shrink-0 gap-1.5 py-2">
              {title}
              <span className="text-xs text-muted-foreground">{t(recordType)}</span>
            </BaseNodeContent>
          </>
        ) : (
          <BaseNodeContent className="h-full min-h-0 gap-2">
            {title}
            {data.description && (
              <p className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {data.description}
              </p>
            )}
            {recordType === 'link' && data.url && (
              <span className="truncate text-xs text-muted-foreground">{data.url}</span>
            )}
            {recordType === 'file' && data.url && (
              <span className="truncate text-xs text-muted-foreground">{data.url.split(/[\\/]/).pop()}</span>
            )}
            <span className="mt-auto text-xs text-muted-foreground">{t(recordType)}</span>
          </BaseNodeContent>
        )}
      </BaseNode>
    </div>
  )
})

export const LinkCanvasNode = memo(function LinkCanvasNode({ id, data }: NodeProps<FlowCanvasNode>) {
  return (
    <BaseNode
      style={nodeStyle(data)}
      className={cn('min-w-52 max-w-80 shadow-sm', previewClassName(data.previewState))}
      onDoubleClick={() => data.url && void openUrl(data.url)}
    >
      <ConnectionHandles />
      <BaseNodeContent className="gap-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ExternalLink className="shrink-0 text-muted-foreground" />
          <EditableLabel id={id} value={data.label ?? '网页链接'} className="text-left" />
        </span>
        <span className="truncate text-xs text-muted-foreground">{data.url}</span>
      </BaseNodeContent>
    </BaseNode>
  )
})

export const TodoCanvasNode = memo(function TodoCanvasNode({ id, data }: NodeProps<FlowCanvasNode>) {
  const { updateNodeData } = useReactFlow<FlowCanvasNode>()
  return (
    <BaseNode style={nodeStyle(data)} className={cn('min-w-52 max-w-80 shadow-sm', previewClassName(data.previewState))}>
      <ConnectionHandles />
      <BaseNodeContent className="flex-row items-center gap-2">
        <button
          type="button"
          className="nodrag text-muted-foreground"
          onClick={() => updateNodeData(id, { checked: !data.checked })}
          aria-label={data.checked ? 'Mark incomplete' : 'Mark complete'}
        >
          {data.checked ? <CheckSquare2 /> : <Square />}
        </button>
        <EditableLabel
          id={id}
          value={data.label ?? '待办事项'}
          className={cn('text-left', data.checked && 'text-muted-foreground line-through')}
        />
      </BaseNodeContent>
    </BaseNode>
  )
})

export const ImageCanvasNode = memo(function ImageCanvasNode({ data }: NodeProps<FlowCanvasNode>) {
  const [imageUrl, setImageUrl] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!data.imagePath) {
      setImageUrl('')
      return
    }
    void convertImageByWorkspace(data.imagePath).then(url => {
      if (!cancelled) setImageUrl(url)
    })
    return () => { cancelled = true }
  }, [data.imagePath])

  return (
    <div className="relative w-64">
      <ConnectionHandles />
      <BaseNode style={nodeStyle(data)} className={cn('w-64 overflow-hidden shadow-sm', previewClassName(data.previewState))}>
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt=""
            width={256}
            height={144}
            unoptimized
            className="block h-36 w-full object-cover"
          />
        ) : (
          <div className="flex h-36 items-center justify-center bg-muted text-muted-foreground"><ImageIcon /></div>
        )}
      </BaseNode>
    </div>
  )
})

export const GroupCanvasNode = memo(function GroupCanvasNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  return (
    <div style={nodeStyle(data)} className={cn('relative size-full rounded-2xl border border-dashed bg-muted/30', previewClassName(data.previewState))}>
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={160}
        onResizeStart={() => emitter.emit('canvas-history-checkpoint')}
      />
      <div className="absolute left-3 top-2 max-w-[calc(100%-1.5rem)] text-sm font-medium text-muted-foreground">
        <EditableLabel id={id} value={data.label ?? '分组'} className="text-left" />
      </div>
    </div>
  )
})

export const ChartCanvasNode = memo(function ChartCanvasNode({ data, selected }: NodeProps<FlowCanvasNode>) {
  const t = useTranslations('canvas')
  const isLoading = data.chartStatus === 'loading'
  const hasError = data.chartStatus === 'error' || (!data.chart && !isLoading)
  const appearance = resolveCanvasChartAppearance(data.chartAppearance)
  return (
    <div className="relative size-full min-h-64 min-w-80">
      <ConnectionHandles />
      <NodeResizer
        isVisible={selected}
        minWidth={360}
        minHeight={260}
        onResizeStart={() => emitter.emit('canvas-history-checkpoint')}
      />
      <div
        data-chart-variant={appearance.variant}
        className={cn(
          'size-full overflow-hidden text-foreground transition-[background-color,border-color,box-shadow] in-[.selected]:ring-2 in-[.selected]:ring-ring/50',
          appearance.variant === 'card' && 'rounded-xl border bg-card shadow-sm in-[.selected]:shadow-md',
          appearance.variant === 'minimal' && 'rounded-lg bg-background/90',
          appearance.variant === 'transparent' && 'rounded-lg bg-transparent',
          previewClassName(data.previewState)
        )}
      >
        <div className={cn(
          'flex size-full flex-col gap-2',
          appearance.variant === 'card' && 'p-4',
          appearance.variant === 'minimal' && 'p-2',
          appearance.variant === 'transparent' && 'p-1'
        )}>
          {appearance.showTitle && (data.chart?.title || data.chartRequest?.title) && (
            <div className="truncate text-center text-sm font-medium">
              {data.chart?.title || data.chartRequest?.title}
            </div>
          )}
          <div className="nodrag flex min-h-0 flex-1 items-center justify-center">
            {isLoading ? (
              <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                <Spinner className="size-6" />
                <span>{t('chart.nodeLoading')}</span>
              </div>
            ) : hasError ? (
              <div className="flex max-w-72 flex-col items-center gap-2 text-center">
                <AlertCircle className="text-destructive" />
                <span className="text-sm font-medium">{t('chart.nodeErrorTitle')}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`chart.errors.${data.chartError || 'CHART_UNKNOWN_ERROR'}`)}
                </span>
                <span className="text-xs text-muted-foreground">{t('chart.nodeErrorHint')}</span>
              </div>
            ) : data.chart ? (
              <CanvasChart spec={data.chart} appearance={appearance} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
})

export const FreehandNode = memo(function FreehandNode({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  const width = data.width || 4
  const height = data.height || 4
  const pathStrokeWidth = data.pathStrokeWidth ?? data.strokeWidth
  const widthAdjustment = typeof pathStrokeWidth === 'number' && typeof data.strokeWidth === 'number'
    ? (data.strokeWidth - pathStrokeWidth) / 2
    : 0
  const filterRadius = Math.abs(widthAdjustment)
  const filterId = `freehand-width-${id}`
  const color = data.color || 'currentColor'
  const opacity = data.opacity ?? 1

  return (
    <div className="relative size-full">
      <NodeResizer
        isVisible={selected}
        minWidth={4}
        minHeight={4}
        onResizeStart={() => emitter.emit('canvas-history-checkpoint')}
      />
      <svg className="size-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
        {filterRadius > 0 && (
          <defs>
            <filter
              id={filterId}
              x={-filterRadius * 2}
              y={-filterRadius * 2}
              width={width + filterRadius * 4}
              height={height + filterRadius * 4}
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feMorphology
                in="SourceAlpha"
                operator={widthAdjustment > 0 ? 'dilate' : 'erode'}
                radius={filterRadius}
                result="adjusted"
              />
              <feFlood floodColor={color} floodOpacity={opacity} result="paint" />
              <feComposite in="paint" in2="adjusted" operator="in" />
            </filter>
          </defs>
        )}
        <path
          d={data.path || ''}
          fill={color}
          fillOpacity={filterRadius > 0 ? 1 : opacity}
          filter={filterRadius > 0 ? `url(#${filterId})` : undefined}
        />
      </svg>
    </div>
  )
})
