'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  Box,
  ChartNoAxesCombined,
  Circle,
  Database,
  Diamond,
  Eraser,
  FileStack,
  FileText,
  Hand,
  HardDrive,
  Hexagon,
  Highlighter,
  ImagePlus,
  Keyboard,
  Layers3,
  Monitor,
  MousePointer2,
  PanelTop,
  Pentagon,
  Pencil,
  RectangleHorizontal,
  Shapes,
  SquareRoundCorner,
  Timer,
  Trash2,
  Type,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { CanvasCustomComponent, CanvasTool } from '@/types/canvas'
import type { CanvasFlowchartNodeType } from '@/lib/canvas/shapes'
import { cn } from '@/lib/utils'

export type InsertableCanvasNodeType = CanvasFlowchartNodeType | 'text'

type ToolPanel = 'shapes' | 'customComponents'
type ShapeGroup = 'common' | 'flowchart' | 'data'

interface ShapeDefinition {
  type: InsertableCanvasNodeType
  icon: LucideIcon
  labelKey: string
  group: ShapeGroup
}

export const CANVAS_SHAPE_DEFINITIONS: readonly ShapeDefinition[] = [
  { type: 'process', icon: RectangleHorizontal, labelKey: 'process', group: 'common' },
  { type: 'decision', icon: Diamond, labelKey: 'decision', group: 'common' },
  { type: 'terminator', icon: SquareRoundCorner, labelKey: 'terminator', group: 'common' },
  { type: 'text', icon: Type, labelKey: 'text', group: 'common' },
  { type: 'input-output', icon: ArrowRightLeft, labelKey: 'inputOutput', group: 'flowchart' },
  { type: 'document', icon: FileText, labelKey: 'document', group: 'flowchart' },
  { type: 'multi-document', icon: FileStack, labelKey: 'multiDocument', group: 'flowchart' },
  { type: 'predefined-process', icon: PanelTop, labelKey: 'predefinedProcess', group: 'flowchart' },
  { type: 'manual-input', icon: Keyboard, labelKey: 'manualInput', group: 'flowchart' },
  { type: 'preparation', icon: Hexagon, labelKey: 'preparation', group: 'flowchart' },
  { type: 'delay', icon: Timer, labelKey: 'delay', group: 'flowchart' },
  { type: 'display', icon: Monitor, labelKey: 'display', group: 'flowchart' },
  { type: 'connector', icon: Circle, labelKey: 'connector', group: 'flowchart' },
  { type: 'off-page-connector', icon: Pentagon, labelKey: 'offPageConnector', group: 'flowchart' },
  { type: 'internal-storage', icon: Box, labelKey: 'internalStorage', group: 'data' },
  { type: 'database', icon: Database, labelKey: 'database', group: 'data' },
  { type: 'stored-data', icon: HardDrive, labelKey: 'storedData', group: 'data' },
] as const

interface RailButtonProps {
  label: string
  active?: boolean
  onClick: () => void
  icon: LucideIcon
  mobile?: boolean
}

function RailButton({ label, active, onClick, icon: Icon, mobile = false }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? 'secondary' : 'ghost'}
          size="icon"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(mobile && 'h-12 min-w-0 flex-1 rounded-md')}
        >
          <Icon data-icon="inline-start" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={mobile ? 'bottom' : 'right'}>{label}</TooltipContent>
    </Tooltip>
  )
}

export function CanvasToolsSidebar({
  tool,
  customComponents,
  chartOpen,
  onToolChange,
  onAddNode,
  onAddImage,
  onOpenChart,
  onCloseChart,
  onPanelOpenChange,
  onInsertCustomComponent,
  onDeleteCustomComponent,
  onShapePreferenceChange,
  mobile = false,
}: {
  tool: CanvasTool
  customComponents: CanvasCustomComponent[]
  chartOpen: boolean
  onToolChange: (tool: CanvasTool) => void
  onAddNode: (nodeType: InsertableCanvasNodeType) => void
  onAddImage: () => void
  onOpenChart: () => void
  onCloseChart: () => void
  onPanelOpenChange: (open: boolean) => void
  onInsertCustomComponent: (component: CanvasCustomComponent) => void
  onDeleteCustomComponent: (id: string) => void
  onShapePreferenceChange: (nodeType: InsertableCanvasNodeType) => void
  mobile?: boolean
}) {
  const t = useTranslations('canvas')
  const [panel, setPanel] = useState<ToolPanel | null>(null)

  const shapeGroups = useMemo(() => {
    return [
      { id: 'common', title: t('toolbox.commonShapes'), items: CANVAS_SHAPE_DEFINITIONS.filter(item => item.group === 'common') },
      { id: 'flowchart', title: t('toolbox.flowchartShapes'), items: CANVAS_SHAPE_DEFINITIONS.filter(item => item.group === 'flowchart') },
      { id: 'data', title: t('toolbox.dataShapes'), items: CANVAS_SHAPE_DEFINITIONS.filter(item => item.group === 'data') },
    ]
  }, [t])

  useEffect(() => {
    if (panel === 'customComponents' && customComponents.length === 0) {
      setPanel(null)
      onPanelOpenChange(false)
    }
  }, [customComponents.length, onPanelOpenChange, panel])

  const openPanel = (nextPanel: ToolPanel) => {
    onCloseChart()
    const next = panel === nextPanel ? null : nextPanel
    setPanel(next)
    onPanelOpenChange(Boolean(next))
  }
  const selectTool = (nextTool: CanvasTool) => {
    onToolChange(nextTool)
    onCloseChart()
    setPanel(null)
    onPanelOpenChange(false)
  }
  const recordShapePreference = (nodeType: InsertableCanvasNodeType) => {
    onShapePreferenceChange(nodeType)
  }
  const insertNode = (nodeType: InsertableCanvasNodeType) => {
    recordShapePreference(nodeType)
    onAddNode(nodeType)
    setPanel(null)
    onPanelOpenChange(false)
  }
  return (
    <div className={cn(
      'absolute z-10 flex',
      mobile
        ? 'inset-x-0 top-0 max-w-none flex-col items-stretch'
        : 'inset-y-3 left-3 max-w-[calc(100%-1.5rem)] items-start'
    )}>
      <div
        role="toolbar"
        aria-label={t('tools.label')}
        className={cn(
          'flex shrink-0 items-center bg-background',
          mobile
            ? 'h-14 w-full flex-row border-b px-1'
            : 'w-12 flex-col gap-1 rounded-xl border p-1 shadow-sm'
        )}
      >
        <RailButton
          label={t('tools.select')}
          active={tool === 'select'}
          icon={MousePointer2}
          onClick={() => selectTool('select')}
          mobile={mobile}
        />
        {!mobile && (
          <RailButton
            label={t('tools.hand')}
            active={tool === 'hand'}
            icon={Hand}
            onClick={() => selectTool('hand')}
          />
        )}
        {!mobile && <Separator />}
        <RailButton
          label={t('tools.pen')}
          active={tool === 'pen'}
          icon={Pencil}
          onClick={() => selectTool('pen')}
          mobile={mobile}
        />
        <RailButton
          label={t('tools.highlighter')}
          active={tool === 'highlighter'}
          icon={Highlighter}
          onClick={() => selectTool('highlighter')}
          mobile={mobile}
        />
        <RailButton
          label={t('tools.eraser')}
          active={tool === 'eraser'}
          icon={Eraser}
          onClick={() => selectTool('eraser')}
          mobile={mobile}
        />
        {!mobile && <Separator />}
        <RailButton
          label={t('toolbox.shapes')}
          active={panel === 'shapes'}
          icon={Shapes}
          onClick={() => openPanel('shapes')}
          mobile={mobile}
        />
        {customComponents.length > 0 && (
          <RailButton
            label={t('toolbox.customComponents')}
            active={panel === 'customComponents'}
            icon={Layers3}
            onClick={() => openPanel('customComponents')}
            mobile={mobile}
          />
        )}
        <RailButton
          label={t('nodes.chart')}
          active={chartOpen}
          icon={ChartNoAxesCombined}
          onClick={() => {
            if (chartOpen) onCloseChart()
            else onOpenChart()
            setPanel(null)
            onPanelOpenChange(false)
          }}
          mobile={mobile}
        />
        <RailButton
          label={t('nodes.image')}
          icon={ImagePlus}
          onClick={() => {
            onCloseChart()
            setPanel(null)
            onPanelOpenChange(false)
            onAddImage()
          }}
          mobile={mobile}
        />
      </div>

      {panel && (
        <div className={cn(
          'flex flex-col overflow-hidden rounded-xl border bg-background shadow-lg',
          mobile
            ? 'mx-3 mt-2 max-h-[min(60vh,32rem)] w-[calc(100%-1.5rem)]'
            : 'ml-2 max-h-full w-[min(18rem,calc(100vw-5.5rem))]'
        )}>
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-4">
            <span className="text-sm font-medium">{t(`toolbox.${panel}`)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('toolbox.close')}
              onClick={() => {
                setPanel(null)
                onPanelOpenChange(false)
              }}
            >
              <X data-icon="inline-start" />
            </Button>
          </div>
          <Separator />
          {panel === 'shapes' && (
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 p-3">
                {shapeGroups.map(group => (
                  <section key={group.id} className="flex flex-col gap-1.5">
                    <h3 className="px-1 text-xs font-medium text-muted-foreground">{group.title}</h3>
                    <div className="grid grid-cols-2 gap-1.5">
                      {group.items.map(item => (
                        <Button
                          key={`${group.id}-${item.type}`}
                          type="button"
                          variant="outline"
                          draggable
                          className="h-10 min-w-0 justify-start gap-2 px-3 font-normal"
                          onClick={() => insertNode(item.type)}
                          onDragStart={(event) => {
                            recordShapePreference(item.type)
                            event.dataTransfer.effectAllowed = 'copy'
                            event.dataTransfer.setData('application/x-notegen-canvas-node', item.type)
                          }}
                        >
                          <item.icon data-icon="inline-start" />
                          <span className="truncate">{t(`nodes.${item.labelKey}`)}</span>
                        </Button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </ScrollArea>
          )}
          {panel === 'customComponents' && (
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-2 p-3">
                {customComponents.map(component => (
                  <div key={component.id} className="flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-w-0 flex-1 justify-start"
                      draggable
                      onClick={() => {
                        onInsertCustomComponent(component)
                        setPanel(null)
                        onPanelOpenChange(false)
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy'
                        event.dataTransfer.setData('application/x-notegen-canvas-component', component.id)
                      }}
                    >
                      <Layers3 data-icon="inline-start" />
                      <span className="truncate">{component.name}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('toolbox.deleteCustomComponent')}
                      onClick={() => onDeleteCustomComponent(component.id)}
                    >
                      <Trash2 data-icon="inline-start" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  )
}
