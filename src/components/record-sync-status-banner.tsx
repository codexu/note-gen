'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  CheckCircle2,
  DownloadCloud,
  Loader2,
  RefreshCw,
  Settings,
  UploadCloud,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  getAutoDataSyncState,
  retryAutoDataSync,
  subscribeAutoDataSyncState,
  type AutoDataSyncPhase,
  type AutoDataSyncState,
} from '@/lib/sync/auto-data-sync-queue'

interface RecordSyncStatusBannerProps {
  settingsHref: string
  compact?: boolean
  className?: string
}

type BannerTone = 'neutral' | 'success' | 'warning' | 'danger'

const SUCCESS_VISIBLE_DURATION = 2_000

function getToneClassName(tone: BannerTone) {
  switch (tone) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
    case 'danger':
      return 'border-destructive/30 bg-destructive/10 text-destructive'
    case 'neutral':
    default:
      return 'border-border bg-muted/35 text-foreground'
  }
}

function getIcon(phase: AutoDataSyncPhase, showSuccess: boolean) {
  if (showSuccess) {
    return <CheckCircle2 className="size-4 shrink-0" />
  }

  switch (phase) {
    case 'checking_remote':
      return <Loader2 className="size-4 shrink-0 animate-spin" />
    case 'uploading':
      return <UploadCloud className="size-4 shrink-0" />
    case 'downloading':
      return <DownloadCloud className="size-4 shrink-0" />
    case 'conflict':
    case 'failed':
      return <AlertTriangle className="size-4 shrink-0" />
    case 'waiting_provider':
      return <Settings className="size-4 shrink-0" />
    case 'idle':
    default:
      return <CheckCircle2 className="size-4 shrink-0" />
  }
}

function getTone(phase: AutoDataSyncPhase, showSuccess: boolean): BannerTone {
  if (showSuccess) {
    return 'success'
  }

  if (phase === 'failed' || phase === 'conflict') {
    return 'danger'
  }

  if (phase === 'waiting_provider') {
    return 'warning'
  }

  return 'neutral'
}

function isRecordTransferState(syncState: AutoDataSyncState) {
  if (syncState.phase === 'downloading') {
    return true
  }

  if (syncState.phase !== 'uploading') {
    return false
  }

  return syncState.currentDomain !== 'settings'
}

function getBannerTitle(
  phase: AutoDataSyncPhase,
  showSuccess: boolean,
  t: ReturnType<typeof useTranslations>
) {
  if (showSuccess) {
    return t('synced')
  }

  if (phase === 'uploading') {
    return t('uploadingRecords')
  }

  if (phase === 'downloading') {
    return t('downloading')
  }

  return t(phase)
}

export function RecordSyncStatusBanner({
  settingsHref,
  compact = false,
  className,
}: RecordSyncStatusBannerProps) {
  const t = useTranslations('record.syncStatus')
  const router = useRouter()
  const [syncState, setSyncState] = useState<AutoDataSyncState>(getAutoDataSyncState())
  const [showSuccess, setShowSuccess] = useState(false)
  const lastCompletedAtRef = useRef<number | null>(syncState.lastCompletedAt)
  const observedTransferRef = useRef(isRecordTransferState(syncState))

  useEffect(() => subscribeAutoDataSyncState(setSyncState), [])

  useEffect(() => {
    if (isRecordTransferState(syncState)) {
      observedTransferRef.current = true
    }
  }, [syncState.phase, syncState.currentDomain])

  useEffect(() => {
    if (!syncState.lastCompletedAt || syncState.lastCompletedAt === lastCompletedAtRef.current) {
      return
    }

    lastCompletedAtRef.current = syncState.lastCompletedAt
    if (!observedTransferRef.current) {
      return
    }

    observedTransferRef.current = false
    setShowSuccess(true)
    const timer = window.setTimeout(() => setShowSuccess(false), SUCCESS_VISIBLE_DURATION)
    return () => window.clearTimeout(timer)
  }, [syncState.lastCompletedAt])

  const phase = syncState.phase
  const shouldShow = useMemo(() => {
    if (phase === 'queued' || phase === 'checking_remote' || phase === 'waiting_provider') {
      return false
    }

    if (phase === 'uploading' && syncState.currentDomain === 'settings') {
      return false
    }

    if (phase === 'idle') {
      return showSuccess
    }

    return true
  }, [phase, showSuccess, syncState.currentDomain])

  if (!shouldShow) {
    return null
  }

  const tone = getTone(phase, showSuccess)
  const isBusy = phase === 'uploading' || phase === 'downloading'
  const title = getBannerTitle(phase, showSuccess, t)
  const description = syncState.lastError

  return (
    <div
      role={phase === 'failed' || phase === 'conflict' ? 'alert' : 'status'}
      className={cn(
        'border-y px-3 py-2',
        getToneClassName(tone),
        className
      )}
    >
      <div className={cn('flex min-w-0 items-center gap-2', compact ? 'text-xs' : 'text-sm')}>
        {getIcon(phase, showSuccess)}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{title}</div>
          {description && !compact ? (
            <div className="truncate text-xs opacity-80">{description}</div>
          ) : null}
        </div>
        {isBusy ? <Loader2 className="size-3.5 shrink-0 animate-spin opacity-80" /> : null}
        {phase === 'failed' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => void retryAutoDataSync()}
          >
            <RefreshCw className="mr-1 size-3.5" />
            {t('retry')}
          </Button>
        ) : null}
        {phase === 'failed' || phase === 'waiting_provider' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => router.push(settingsHref)}
          >
            <Settings className="mr-1 size-3.5" />
            {t('settings')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
