export type ActivitySource = 'record' | 'chat' | 'writing'

export interface ActivityEntry {
  id: string
  source: ActivitySource
  timestamp: number
  title: string
  description?: string
  path?: string
  tagId?: number
  meta?: Record<string, string | number | boolean | null | undefined>
}

export interface ActivityDaySummary {
  day: string
  totalCount: number
  counts: Record<ActivitySource, number>
  entries: ActivityEntry[]
}

export interface ActivityHeatmapWeek {
  days: ActivityDaySummary[]
}

export interface ActivityCalendarData {
  timeZone: string
  startDate: string
  endDate: string
  generatedAt: number
  totals: {
    totalCount: number
    activeDays: number
    recordCount: number
    chatCount: number
    writingCount: number
  }
  days: ActivityDaySummary[]
  weeks: ActivityHeatmapWeek[]
}
