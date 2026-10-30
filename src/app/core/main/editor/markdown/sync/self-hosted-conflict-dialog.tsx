'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CircleAlert, RefreshCw, X } from 'lucide-react'

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/responsive-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { SyncContentComparison } from '@/components/sync-content-comparison'

interface SelfHostedConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  relativePath: string
  localContent: string
  remoteContent: string
  loading: boolean
  busy: boolean
  error: string
  onRefresh: () => void
  onResolve: (content: string) => Promise<void>
}

export function SelfHostedConflictDialog({
  open,
  onOpenChange,
  relativePath,
  localContent,
  remoteContent,
  loading,
  busy,
  error,
  onRefresh,
  onResolve,
}: SelfHostedConflictDialogProps) {
  const t = useTranslations('syncOverview.selfHostedConflict')
  const fieldId = useId()
  const [mergedContent, setMergedContent] = useState(localContent)
  const [resolving, setResolving] = useState(false)
  const [resolutionError, setResolutionError] = useState('')
  const initializedPathRef = useRef<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const operationRef = useRef(false)
  const working = busy || resolving
  const visibleError = error || resolutionError
  const disabled = loading || working || Boolean(visibleError)

  useEffect(() => {
    if (!open) {
      initializedPathRef.current = null
      setResolutionError('')
      return
    }
    if (loading || error || initializedPathRef.current === relativePath) return

    initializedPathRef.current = relativePath
    setMergedContent(localContent)
    setResolutionError('')
  }, [error, loading, localContent, open, relativePath])

  const resolve = async (content: string) => {
    if (disabled || operationRef.current) return
    operationRef.current = true
    setResolving(true)
    setResolutionError('')
    try {
      await onResolve(content)
    } catch (cause) {
      setResolutionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      operationRef.current = false
      setResolving(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={nextOpen => {
      if (!working) onOpenChange(nextOpen)
    }}>
      <ResponsiveDialogContent
        ref={contentRef}
        tabIndex={-1}
        className="flex min-h-0 min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl [&>[data-slot=drawer-scroll-area]]:overflow-hidden"
        style={{ height: 'min(54rem, calc(var(--mobile-viewport-height, 100dvh) - env(safe-area-inset-top) - 1rem))', maxHeight: 'calc(var(--mobile-viewport-height, 100dvh) - env(safe-area-inset-top) - 1rem)' }}
        showCloseButton={false}
        onOpenAutoFocus={event => {
          event.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
      >
        <ResponsiveDialogHeader className="max-h-[40%] shrink-0 gap-2 overflow-y-auto overscroll-contain p-4 text-left">
          <div className="flex items-center justify-between gap-3">
            <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>
            <Button type="button" variant="ghost" size="icon-sm" disabled={working} aria-label={t('close')} onClick={() => onOpenChange(false)}><X /></Button>
          </div>
          <ResponsiveDialogDescription>{t('description')}</ResponsiveDialogDescription>
          <p className="line-clamp-2 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]" title={relativePath}>{relativePath}</p>
        </ResponsiveDialogHeader>

        <div data-vaul-no-drag className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4">
          {loading ? (
            <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner aria-hidden="true" />
              <span>{t('loading')}</span>
            </div>
          ) : null}

          {visibleError ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription className="whitespace-pre-wrap [overflow-wrap:anywhere]">{visibleError}</AlertDescription>
            </Alert>
          ) : null}

          <SyncContentComparison
            key={relativePath}
            localContent={localContent}
            remoteContent={remoteContent}
            localLabel={t('local')}
            remoteLabel={t('remote')}
            mergeLabel={t('merged')}
            mergePanel={<Field data-disabled={disabled} className="min-w-0">
              <FieldLabel htmlFor={`${fieldId}-merged`}>{t('merged')}</FieldLabel>
              <FieldDescription id={`${fieldId}-merge-description`}>{t('mergeDescription')}</FieldDescription>
              <Textarea
                id={`${fieldId}-merged`}
                value={mergedContent}
                onChange={event => setMergedContent(event.target.value)}
                disabled={disabled}
                aria-describedby={`${fieldId}-merge-description`}
                className="h-[clamp(10rem,32dvh,24rem)] min-h-40 resize-none [field-sizing:fixed]"
              />
            </Field>}
          />
        </div>

        <ResponsiveDialogFooter className="m-0 grid max-h-[40%] shrink-0 grid-cols-2 gap-2 overflow-y-auto overscroll-contain border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex sm:flex-row sm:flex-wrap [&>button]:h-auto [&>button]:min-h-9 [&>button]:min-w-0 [&>button]:whitespace-normal [&>button]:[overflow-wrap:anywhere]">
          <Button type="button" variant="ghost" disabled={loading || working} onClick={() => {
            setResolutionError('')
            onRefresh()
          }}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            {t('refresh')}
          </Button>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => void resolve(localContent)}>
            {t('keepLocal')}
          </Button>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => void resolve(remoteContent)}>
            {t('keepRemote')}
          </Button>
          <Button type="button" disabled={disabled} aria-busy={working} onClick={() => void resolve(mergedContent)}>
            {working ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
            {t('saveMerge')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
