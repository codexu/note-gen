'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CircleAlert, RefreshCw } from 'lucide-react'

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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

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
        className="flex max-h-[88dvh] flex-col gap-4 overflow-hidden p-0 sm:max-w-5xl"
        showCloseButton={!working}
        onOpenAutoFocus={event => {
          event.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
      >
        <ResponsiveDialogHeader className="shrink-0 px-4 pt-4">
          <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('description')}</ResponsiveDialogDescription>
          <p className="truncate text-sm text-muted-foreground" title={relativePath}>{relativePath}</p>
        </ResponsiveDialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4">
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

          <FieldGroup>
            <FieldGroup className="grid min-w-0 gap-4 md:grid-cols-2">
              <Field className="min-w-0">
                <FieldLabel htmlFor={`${fieldId}-local`}>{t('local')}</FieldLabel>
                <Textarea
                  id={`${fieldId}-local`}
                  value={localContent}
                  readOnly
                  className="h-36 min-h-36 resize-none [field-sizing:fixed]"
                />
              </Field>
              <Field className="min-w-0">
                <FieldLabel htmlFor={`${fieldId}-remote`}>{t('remote')}</FieldLabel>
                <Textarea
                  id={`${fieldId}-remote`}
                  value={remoteContent}
                  readOnly
                  className="h-36 min-h-36 resize-none [field-sizing:fixed]"
                />
              </Field>
            </FieldGroup>

            <Field data-disabled={disabled}>
              <FieldLabel htmlFor={`${fieldId}-merged`}>{t('merged')}</FieldLabel>
              <FieldDescription id={`${fieldId}-merge-description`}>{t('mergeDescription')}</FieldDescription>
              <Textarea
                id={`${fieldId}-merged`}
                value={mergedContent}
                onChange={event => setMergedContent(event.target.value)}
                disabled={disabled}
                aria-describedby={`${fieldId}-merge-description`}
                className="h-44 min-h-44 resize-none [field-sizing:fixed]"
              />
            </Field>
          </FieldGroup>
        </div>

        <ResponsiveDialogFooter className="m-0 shrink-0 gap-2 p-4">
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
