'use client'

import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { Mark } from '@/db/marks'
import { getImageRecordStatus } from './image-record-status'
import { canEditRecordDescription } from './mark-list-item-content'
import { readRecordAfterPendingWrites, saveRecordDescription } from './use-record-detail-save'

interface RecordDescriptionDialogProps {
  mark: Pick<Mark, 'id'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (mark: Mark) => void
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>['onCloseAutoFocus']
}

interface DescriptionDraft {
  expected: string | undefined
  initialValue: string
  value: string
}

type DescriptionError = 'notFound' | 'descriptionLoadFailed' | 'descriptionChanged' | 'saveFailed' | 'recognitionPending'

export function RecordDescriptionDialog({ mark, open, onOpenChange, onSaved, onCloseAutoFocus }: RecordDescriptionDialogProps) {
  const t = useTranslations()
  const fieldId = useId()
  const [draft, setDraft] = useState<DescriptionDraft | null>(null)
  const [error, setError] = useState<DescriptionError | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const saving = useRef(false)
  const value = draft?.value.trim() ?? ''
  const canSave = draft !== null && value !== draft.initialValue.trim() && error !== 'descriptionChanged' && !isSaving

  useLayoutEffect(() => {
    if (!open) return
    setDraft(null)
    setError(null)
    let cancelled = false
    void readRecordAfterPendingWrites(mark.id).then(current => {
      if (cancelled) return
      if (!current || !canEditRecordDescription(current)) {
        setError('notFound')
        return
      }
      const recognition = getImageRecordStatus(current, {
        pending: t('record.capture.screenshotRecognitionPending'),
        failed: t('record.capture.screenshotRecognitionFailed'),
        noText: t('record.capture.screenshotNoText'),
        savedOnly: t('record.capture.screenshotSavedOnly'),
      })
      if (recognition === 'pending') {
        setError('recognitionPending')
        return
      }
      const initialValue = recognition ? '' : current.desc || ''
      setDraft({ expected: current.desc, initialValue, value: initialValue })
    }).catch(cause => {
      if (cancelled) return
      console.error('Failed to read the record description:', cause)
      setError('descriptionLoadFailed')
    })
    return () => { cancelled = true }
  }, [mark.id, open, t])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || !canSave || saving.current) return
    saving.current = true
    setIsSaving(true)
    setError(null)
    let saved: Mark | null
    try {
      saved = await saveRecordDescription(mark.id, draft.expected, value)
      if (!saved) {
        setError('descriptionChanged')
        return
      }
    } catch (cause) {
      console.error('Failed to save the record description:', cause)
      setError('saveFailed')
      return
    } finally {
      saving.current = false
      setIsSaving(false)
    }
    onSaved?.(saved)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving.current) onOpenChange(next) }}>
      <DialogContent
        className="max-h-[min(85dvh,var(--mobile-viewport-height,100dvh))] overflow-y-auto sm:min-w-0 sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('record.mark.detail.editDescription')}</DialogTitle>
          <DialogDescription>{t('record.mark.detail.descriptionHelp')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={event => void submit(event)}>
          {draft ? (
            <Field>
              <FieldLabel htmlFor={fieldId}>{t('record.mark.desc')}</FieldLabel>
              <Textarea
                id={fieldId}
                autoFocus
                rows={3}
                maxRows={8}
                value={draft.value}
                disabled={isSaving}
                onChange={event => setDraft({ ...draft, value: event.target.value })}
              />
            </Field>
          ) : !error ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
              {t('common.loading')}
            </p>
          ) : null}
          {error ? (
            <Alert variant={error === 'recognitionPending' ? 'default' : 'destructive'}>
              <AlertDescription>
                {error === 'recognitionPending' ? t('record.capture.screenshotRecognitionPending') : t(`record.mark.detail.${error}`)}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!canSave}>{isSaving ? t('common.saving') : t('common.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
