'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ActivityDaySummary, ActivityHeatmapWeek } from '@/lib/activity/types'

interface ActivityHeatmapProps {
  weeks: ActivityHeatmapWeek[]
  selectedDay?: string
  onSelectDay: (day: ActivityDaySummary) => void
  compact?: boolean
  labels: {
    dayCount: string
    emptyDay: string
  }
}

function getIntensityLevel(totalCount: number) {
  if (totalCount <= 0) return 0
  if (totalCount <= 5) return 1
  if (totalCount <= 10) return 2
  if (totalCount <= 20) return 3
  return 4
}

const LEVEL_CLASSES = [
  'bg-muted hover:bg-muted/80',
  'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:hover:bg-emerald-900',
  'bg-emerald-300 hover:bg-emerald-400 dark:bg-emerald-800/80 dark:hover:bg-emerald-700',
  'bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-600/90 dark:hover:bg-emerald-500',
  'bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-400/90 dark:hover:bg-emerald-300',
] as const

export function ActivityHeatmap({
  weeks,
  selectedDay,
  onSelectDay,
  compact = false,
  labels,
}: ActivityHeatmapProps) {
  return (
    <TooltipProvider>
      <div className="w-full overflow-visible px-1 py-1">
        <div className={cn('inline-flex gap-1.5', compact && 'gap-1')}>
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className={cn('flex flex-col gap-1.5', compact && 'gap-1')}>
              {week.days.map((day) => {
                const level = getIntensityLevel(day.totalCount)
                const isSelected = selectedDay === day.day
                const tooltipText = day.totalCount > 0
                  ? `${day.day} · ${day.totalCount} ${labels.dayCount}`
                  : `${day.day} · ${labels.emptyDay}`

                return (
                  <Tooltip key={day.day}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onSelectDay(day)}
                        className={cn(
                          compact ? 'h-3 w-3 rounded-[3px] border border-black/5 transition-colors' : 'h-4 w-4 rounded-[4px] border border-black/5 transition-colors',
                          LEVEL_CLASSES[level],
                          isSelected && (compact
                            ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                            : 'ring-2 ring-primary ring-offset-2 ring-offset-background')
                        )}
                        aria-label={tooltipText}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{tooltipText}</p>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}
