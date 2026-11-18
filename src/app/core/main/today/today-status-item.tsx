'use client'

// Fork (D2): status bar entry "需處理 N" that opens the Today tab.
import useInboxStore, { selectStaleRecords } from '@/stores/inbox'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { groupTasks, needAttentionCount, staleInboxNotes } from '@/lib/today/today-model'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'
import { openTodayTab } from './today-tab'

export function TodayStatusItem() {
  const t = useTranslations('today')
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const status = useVaultIndexStore(state => state.status)
  const inboxFolder = useDailySettingsStore(state => state.inboxFolder)
  const staleDays = useDailySettingsStore(state => state.staleDays)
  const records = useInboxStore(state => state.records)
  const processed = useInboxStore(state => state.processed)
  const initSettings = useDailySettingsStore(state => state.initSettings)
  useEffect(() => { void initSettings() }, [initSettings])

  // 日期換日時重算
  const [day, setDay] = useState(() => new Date().toDateString())
  useEffect(() => {
    const timer = window.setInterval(() => setDay(new Date().toDateString()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const count = useMemo(() => {
    const now = new Date()
    const groups = groupTasks(selectAllTasks({ notes, revision }), now)
    const staleRecords = selectStaleRecords({ records, processed }, staleDays, now).length
    return needAttentionCount(groups, staleInboxNotes(notes.values(), inboxFolder, staleDays, now).length + staleRecords)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, revision, inboxFolder, staleDays, day, records, processed])

  const label = status === 'ready' && count > 0 ? t('status.need', { count }) : t('status.open')
  return (
    <button
      type="button"
      onClick={openTodayTab}
      className={`flex h-5 cursor-pointer items-center gap-1 rounded px-1.5 hover:bg-muted ${count > 0 ? 'text-foreground' : ''}`}
      aria-label={status === 'ready' ? t('status.aria', { count }) : t('status.open')}
      title={t('status.open')}
    >
      {count > 0 && status === 'ready'
        ? <AlertTriangle className="size-3 text-ink" aria-hidden />
        : <CalendarCheck className="size-3" aria-hidden />}
      <span className="tabular-nums">{label}</span>
    </button>
  )
}
