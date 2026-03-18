'use client'

import { Badge } from '@/components/ui/badge'
import type { ActivityDaySummary, ActivityEntry } from '@/lib/activity/types'

interface ActivityDayDetailProps {
  day?: ActivityDaySummary
  compact?: boolean
  labels: {
    empty: string
    records: string
    writing: string
    chats: string
  }
}

const badgeClassMap = {
  record: 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950/70 dark:text-rose-200',
  writing: 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200',
  chat: 'border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-900 dark:bg-sky-950/70 dark:text-sky-200',
} as const

function getSourceLabel(source: ActivityEntry['source'], labels: ActivityDayDetailProps['labels']) {
  return {
    record: labels.records,
    chat: labels.chats,
    writing: labels.writing,
  }[source]
}

function renderSourceBadge(entry: ActivityEntry, labels: ActivityDayDetailProps['labels']) {
  const label = getSourceLabel(entry.source, labels)

  return (
    <Badge
      variant="outline"
      className={`shrink-0 whitespace-nowrap border capitalize ${badgeClassMap[entry.source]}`}
    >
      {label}
    </Badge>
  )
}

function formatEntryBucket(timestamp: number) {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = date.getMinutes() >= 30 ? '30' : '00'
  return `${hours}:${minutes}`
}

function formatEntryTime(timestamp: number) {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function normalizeText(value?: string) {
  return value?.replace(/\s+/g, ' ').trim() || ''
}

function getEntryBodyText(entry: ActivityEntry) {
  if (entry.source === 'writing') {
    return normalizeText(entry.title || entry.path || entry.description)
  }

  return normalizeText(entry.description || entry.title)
}

function getWritingMergeKey(entry: ActivityEntry) {
  return normalizeText(entry.path || entry.title || entry.description)
}

function dedupeGroupEntries(entries: ActivityEntry[]) {
  const dedupedEntries: ActivityEntry[] = []
  const writingKeys = new Set<string>()

  for (const entry of entries) {
    if (entry.source !== 'writing') {
      dedupedEntries.push(entry)
      continue
    }

    const mergeKey = getWritingMergeKey(entry)
    if (writingKeys.has(mergeKey)) {
      continue
    }

    writingKeys.add(mergeKey)
    dedupedEntries.push(entry)
  }

  return dedupedEntries
}

function groupEntriesByBucket(entries: ActivityEntry[]) {
  const groups = new Map<string, ActivityEntry[]>()

  for (const entry of entries) {
    const bucket = formatEntryBucket(entry.timestamp)
    const nextEntries = groups.get(bucket) || []
    nextEntries.push(entry)
    groups.set(bucket, nextEntries)
  }

  return Array.from(groups.entries()).map(([bucket, groupEntries]) => ({
    bucket,
    entries: dedupeGroupEntries(groupEntries),
  }))
}

export function ActivityDayDetail({ day, compact = false, labels }: ActivityDayDetailProps) {
  const hourGroups = day ? groupEntriesByBucket(day.entries) : []

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{day?.day || new Date().toISOString().slice(0, 10)}</h3>
        {day ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline" className={`border ${badgeClassMap.record}`}>
              {labels.records}: {day.counts.record}
            </Badge>
            <Badge variant="outline" className={`border ${badgeClassMap.writing}`}>
              {labels.writing}: {day.counts.writing}
            </Badge>
            <Badge variant="outline" className={`border ${badgeClassMap.chat}`}>
              {labels.chats}: {day.counts.chat}
            </Badge>
          </div>
        ) : null}
      </div>
      <div className="space-y-1">
        {!day ? (
          <p className="text-sm text-muted-foreground">{labels.empty}</p>
        ) : null}
      </div>
      {day ? (
        <div className="space-y-3">
          <div className="space-y-3">
            {hourGroups.map((group) => (
              <div key={group.bucket} className="grid grid-cols-[max-content_0.875rem_minmax(0,1fr)] gap-2">
                <div className="pt-1 pr-0.5 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                  <span className="block whitespace-nowrap">{group.bucket}</span>
                </div>
                <div className="relative flex justify-center">
                  <div className="absolute inset-y-0 w-px bg-border/70" />
                  <div className="absolute top-2 size-2.5 rounded-full border border-background bg-primary shadow-sm" />
                </div>
                <div className="space-y-2">
                  {group.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className={compact ? 'rounded-xl bg-muted/35 px-3 py-2.5' : 'rounded-xl border border-border/60 p-3'}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          {renderSourceBadge(entry, labels)}
                          <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
                            {formatEntryTime(entry.timestamp)}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-sm leading-6">
                          {getEntryBodyText(entry)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
