'use client'

import {
  ClipboardPaste,
  Download,
  FileCode2,
  FileInput,
  Grid3X3,
  ImageDown,
  ImagePlus,
  Magnet,
  Maximize2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { StatusBarItem } from '../status-bar-order'

interface CanvasFooterProps {
  showGrid: boolean
  snapToGrid: boolean
  zoom: number
  onToggleGrid: () => void
  onToggleSnap: () => void
  onZoomChange: (zoom: number) => void
  onFitView: () => void
  onLayout: () => void
  onExport: (format: 'png' | 'svg', pixelRatio: number) => void
  onExportRecord: () => void
  onExportSource: (format: 'canvas' | 'mermaid') => void
  onImportFile: () => void
  onImportContent: () => void
  embedded?: boolean
}

function FooterButton({
  label,
  active,
  onClick,
  children,
  sortableId,
  rank,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  sortableId?: string
  rank?: number
}) {
  const control = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active === true ? 'secondary' : 'ghost'}
          size="xs"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
        >
          {children}
          <span>{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
  return sortableId && rank !== undefined ? <StatusBarItem id={sortableId} rank={rank}>{control}</StatusBarItem> : control
}

function CanvasTool({ embedded, id, rank, children }: { embedded: boolean; id: string; rank: number; children: React.ReactNode }) {
  return embedded ? <StatusBarItem id={id} rank={rank}>{children}</StatusBarItem> : children
}

export function CanvasFooter({
  showGrid,
  snapToGrid,
  zoom,
  onToggleGrid,
  onToggleSnap,
  onZoomChange,
  onFitView,
  onLayout,
  onExport,
  onExportRecord,
  onExportSource,
  onImportFile,
  onImportContent,
  embedded = false,
}: CanvasFooterProps) {
  const t = useTranslations('canvas.footer')

  return (
    <div className={cn(
      'flex h-6 min-h-6 max-h-6 min-w-0 shrink-0 items-center gap-2 overflow-hidden bg-background text-xs text-muted-foreground',
      embedded ? 'contents' : 'w-full justify-between border-t border-border px-3',
    )}>
      <div className={embedded ? 'contents' : 'flex shrink-0 items-center gap-0.5'}>
        <FooterButton label={t('grid')} active={showGrid} onClick={onToggleGrid} sortableId={embedded ? 'canvas:grid' : undefined} rank={20}>
          <Grid3X3 />
        </FooterButton>
        <FooterButton label={t('snap')} active={snapToGrid} onClick={onToggleSnap} sortableId={embedded ? 'canvas:snap' : undefined} rank={21}>
          <Magnet />
        </FooterButton>
        <FooterButton label={t('layout')} onClick={onLayout} sortableId={embedded ? 'canvas:layout' : undefined} rank={22}>
          <WandSparkles />
        </FooterButton>
        <CanvasTool embedded={embedded} id="canvas:import" rank={23}><DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="xs" aria-label={t('import.title')}>
                  <FileInput />
                  <span>{t('import.title')}</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{t('import.title')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuItem onSelect={onImportFile}>
              <FileInput />
              {t('import.file')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onImportContent}>
              <ClipboardPaste />
              {t('import.content')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu></CanvasTool>
        <CanvasTool embedded={embedded} id="canvas:export" rank={24}><DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="xs" aria-label={t('export')}>
                  <Download />
                  <span>{t('export')}</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{t('export')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onExportRecord}>
                <ImagePlus />
                {t('exportMenu.record')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('exportMenu.computer')}</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onExport('png', 2)}>
                <ImageDown />
                {t('exportMenu.png2x')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport('png', 4)}>
                <ImageDown />
                {t('exportMenu.png4x')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport('svg', 1)}>
                <FileCode2 />
                {t('exportMenu.svg')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('exportMenu.source')}</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onExportSource('canvas')}>
                <FileCode2 />
                {t('exportMenu.canvasFile')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExportSource('mermaid')}>
                <FileCode2 />
                {t('exportMenu.mermaid')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu></CanvasTool>
      </div>

      <div className={embedded ? 'contents' : 'flex shrink-0 items-center gap-0.5'}>
        <CanvasTool embedded={embedded} id="canvas:zoom" rank={60}><div className="flex items-center gap-1.5 px-1">
          <ZoomOut className="size-3" aria-hidden="true" />
          <Slider
            min={0.25}
            max={2}
            step={0.05}
            value={[zoom]}
            onValueChange={value => onZoomChange(value[0] ?? zoom)}
            aria-label={`${t('zoomOut')} / ${t('zoomIn')}`}
            className="w-20"
          />
          <ZoomIn className="size-3" aria-hidden="true" />
          <span className="w-9 text-right tabular-nums">{Math.round(zoom * 100)}%</span>
        </div></CanvasTool>
        <FooterButton label={t('fit')} onClick={onFitView} sortableId={embedded ? 'canvas:fit' : undefined} rank={61}>
          <Maximize2 />
        </FooterButton>
      </div>
    </div>
  )
}
