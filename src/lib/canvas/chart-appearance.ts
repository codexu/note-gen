import type {
  CanvasChartAppearance,
  CanvasChartPalette,
} from '@/types/canvas'

export const DEFAULT_CANVAS_CHART_APPEARANCE: CanvasChartAppearance = {
  variant: 'card',
  palette: 'system',
  showTitle: true,
  showLegend: true,
  showGrid: true,
  showXAxis: true,
  showYAxis: true,
}

const RUNTIME_PALETTES: Record<CanvasChartPalette, string[]> = {
  system: [
    'var(--color-chart-1)',
    'var(--color-chart-2)',
    'var(--color-chart-3)',
    'var(--color-chart-4)',
    'var(--color-chart-5)',
  ],
  cool: ['#2563eb', '#0891b2', '#7c3aed', '#0284c7', '#4f46e5'],
  warm: ['#ea580c', '#dc2626', '#d97706', '#db2777', '#ca8a04'],
  monochrome: [
    'color-mix(in srgb, var(--foreground) 92%, transparent)',
    'color-mix(in srgb, var(--foreground) 76%, transparent)',
    'color-mix(in srgb, var(--foreground) 60%, transparent)',
    'color-mix(in srgb, var(--foreground) 44%, transparent)',
    'color-mix(in srgb, var(--foreground) 28%, transparent)',
  ],
}

const EXPORT_PALETTES: Record<CanvasChartPalette, string[]> = {
  ...RUNTIME_PALETTES,
  system: ['#e76e50', '#319795', '#45687a', '#ddb957', '#e88743'],
  monochrome: ['#18181b', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8'],
}

export function resolveCanvasChartAppearance(
  appearance?: Partial<CanvasChartAppearance>
): CanvasChartAppearance {
  return { ...DEFAULT_CANVAS_CHART_APPEARANCE, ...appearance }
}

export function getCanvasChartColors(palette: CanvasChartPalette, staticExport = false) {
  return (staticExport ? EXPORT_PALETTES : RUNTIME_PALETTES)[palette]
}
