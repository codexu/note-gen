'use client'

// Fork（#32）：本週足跡（預設關閉）。ActivityTracker 一直在背景記錄，卡片打開時才顯示。
import { useEffect, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { diffSnapshots, weekCounts } from '@/lib/home/activity'
import useArticleStore from '@/stores/article'
import useHomeActivityStore from '@/stores/home-activity'
import useVaultIndexStore from '@/stores/vault-index'

/** 比對索引快照記下寫下／修改；打開筆記記下重讀。 */
export function ActivityTracker() {
  const load = useHomeActivityStore(state => state.load)
  const loaded = useHomeActivityStore(state => state.loaded)
  const notes = useVaultIndexStore(state => state.notes)
  const status = useVaultIndexStore(state => state.status)
  const activeFilePath = useArticleStore(state => state.activeFilePath)
  const snapshot = useRef<Map<string, number> | null>(null)

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!loaded || status !== 'ready') return
    const next = new Map([...notes.values()].map(note => [note.path, note.mtime]))
    const { created, modified } = diffSnapshots(snapshot.current, next)
    snapshot.current = next
    const { record } = useHomeActivityStore.getState()
    record('created', created)
    record('modified', modified)
  }, [notes, status, loaded])

  useEffect(() => {
    if (!loaded || !activeFilePath || !notes.has(activeFilePath)) return
    useHomeActivityStore.getState().record('reread', [activeFilePath])
    // 只在切換檔案時記一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath, loaded])

  return null
}

export function FootprintCard() {
  const t = useTranslations('home.footprint')
  const locale = useLocale()
  const log = useHomeActivityStore(state => state.log)
  const week = weekCounts(log, new Date())
  const max = Math.max(1, ...week.map(day => day.created + day.modified + day.reread))
  const total = week.reduce((sum, day) => ({ created: sum.created + day.created, modified: sum.modified + day.modified, reread: sum.reread + day.reread }), { created: 0, modified: 0, reread: 0 })

  return (
    <section className="rounded-xl bg-background p-4" aria-labelledby="home-footprint">
      <h2 id="home-footprint" className="mb-1 text-[15px] font-semibold">{t('title')}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{t('summary', total)}</p>
      <div className="flex h-24 items-end gap-2" role="img" aria-label={t('summary', total)}>
        {week.map(day => {
          const sum = day.created + day.modified + day.reread
          return (
            <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={t('day', { ...day })}>
              <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${Math.max(2, (sum / max) * 72)}px` }}>
                <div className="bg-ink" style={{ flex: day.created }} />
                <div className="bg-ink/50" style={{ flex: day.modified }} />
                <div className="bg-muted-foreground/40" style={{ flex: day.reread || (sum === 0 ? 1 : 0) }} />
              </div>
              <span className="text-xs text-muted-foreground">{new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(`${day.date}T00:00:00`))}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-ink" />{t('created')}</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-ink/50" />{t('modified')}</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-muted-foreground/40" />{t('reread')}</span>
      </div>
    </section>
  )
}
