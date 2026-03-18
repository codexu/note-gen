import type { ActivityDaySummary, ActivityEntry, ActivityHeatmapWeek, ActivitySource } from './types'

const DEFAULT_COUNTS: Record<ActivitySource, number> = Object.freeze({
  record: 0,
  chat: 0,
  writing: 0,
})

function formatDayKey(timestamp: number, timeZone?: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
}

function cloneCounts(): Record<ActivitySource, number> {
  return {
    record: DEFAULT_COUNTS.record,
    chat: DEFAULT_COUNTS.chat,
    writing: DEFAULT_COUNTS.writing,
  }
}

export function summarizeActivityEntries(entries: ActivityEntry[], options: { timeZone?: string } = {}): ActivityDaySummary[] {
  const { timeZone } = options
  const dayMap = new Map<string, ActivityDaySummary>()

  for (const entry of entries) {
    const day = formatDayKey(entry.timestamp, timeZone)

    if (!dayMap.has(day)) {
      dayMap.set(day, {
        day,
        totalCount: 0,
        counts: cloneCounts(),
        entries: [],
      })
    }

    const summary = dayMap.get(day)
    if (!summary) continue

    summary.totalCount += 1
    summary.counts[entry.source] += 1
    summary.entries.push(entry)
  }

  return Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day))
}

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function buildActivityHeatmap(
  summaries: ActivityDaySummary[],
  options: { startDate: string; endDate: string }
): { weeks: ActivityHeatmapWeek[] } {
  const { startDate, endDate } = options
  const summaryMap = new Map(summaries.map(summary => [summary.day, summary]))
  const days: ActivityDaySummary[] = []

  let currentDay = startDate
  while (currentDay <= endDate) {
    const summary = summaryMap.get(currentDay)
    days.push(summary || {
      day: currentDay,
      totalCount: 0,
      counts: cloneCounts(),
      entries: [],
    })
    currentDay = shiftDay(currentDay, 1)
  }

  const weeks: ActivityHeatmapWeek[] = []
  for (let index = 0; index < days.length; index += 7) {
    weeks.push({
      days: days.slice(index, index + 7),
    })
  }

  return {
    weeks,
  }
}
