'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import type { ActivityDaySummary, ActivityHeatmapWeek } from '@/lib/activity/types'

interface ActivityHeatmapProps {
  weeks: ActivityHeatmapWeek[]
  selectedDay?: string
  onSelectDay: (day: ActivityDaySummary) => void
  compact?: boolean
  adaptive?: boolean
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
  adaptive = false,
  labels,
}: ActivityHeatmapProps) {
  const isMobile = useIsMobile()

  return (
    <TooltipProvider>
      <div className="flex w-full justify-end overflow-visible px-1 py-1">
        <div className={cn(adaptive ? 'grid w-full grid-flow-col auto-cols-fr gap-1' : 'inline-flex gap-1.5', compact && !adaptive && 'gap-1')}>
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className={cn(adaptive ? 'grid grid-rows-7 gap-1' : 'flex flex-col gap-1.5', compact && !adaptive && 'gap-1')}>
              {week.days.map((day) => {
                const level = getIntensityLevel(day.totalCount)
                const isSelected = selectedDay === day.day
                const tooltipText = day.totalCount > 0
                  ? `${day.day} · ${day.totalCount} ${labels.dayCount}`
                  : `${day.day} · ${labels.emptyDay}`

                const dayButton = (
                  <button
                    key={day.day}
                    type="button"
                    data-slot="activity-heatmap-day"
                    onClick={() => onSelectDay(day)}
                    className={cn(
                      adaptive
                        ? 'aspect-square w-full min-w-0 rounded-[4px] border border-black/5 transition-colors'
                        : compact
                          ? 'h-3 w-3 rounded-[3px] border border-black/5 transition-colors'
                          : 'h-4 w-4 rounded-[4px] border border-black/5 transition-colors',
                      LEVEL_CLASSES[level],
                      isSelected && (compact
                        ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                        : 'ring-2 ring-primary ring-offset-2 ring-offset-background')
                    )}
                    aria-label={tooltipText}
                  />
                )

                return isMobile ? dayButton : (
                  <Tooltip key={day.day}>
                    <TooltipTrigger asChild>{dayButton}</TooltipTrigger>
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
