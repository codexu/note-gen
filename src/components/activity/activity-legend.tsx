'use client'

interface ActivityLegendProps {
  lowLabel: string
  highLabel: string
}

const LEVEL_CLASSES = [
  'bg-muted',
  'bg-emerald-100 dark:bg-emerald-950/70',
  'bg-emerald-300 dark:bg-emerald-800/80',
  'bg-emerald-500 dark:bg-emerald-600/90',
  'bg-emerald-700 dark:bg-emerald-400/90',
] as const

export function ActivityLegend({ lowLabel, highLabel }: ActivityLegendProps) {
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
      <span>{lowLabel}</span>
      <div className="flex items-center gap-1">
        {LEVEL_CLASSES.map((className, index) => (
          <span key={index} className={`h-3 w-3 rounded-[4px] ${className}`} />
        ))}
      </div>
      <span>{highLabel}</span>
    </div>
  )
}
