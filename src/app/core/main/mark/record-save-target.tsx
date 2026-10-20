'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MobileSelectDrawer } from '@/app/mobile/components/mobile-select-drawer'
import type { Tag } from '@/db/tags'
import { useTranslations } from 'next-intl'

interface RecordSaveTargetProps {
  selectedTagId: number
  tags: Tag[]
  onTagChange: (tagId: number) => void
  mobile?: boolean
  disabled?: boolean
  onCreateTag?: (name: string) => Promise<Tag>
  onCreatingChange?: (creating: boolean) => void
}

export function RecordSaveTarget({
  selectedTagId, tags, onTagChange, mobile = false, disabled = false,
  onCreateTag, onCreatingChange,
}: RecordSaveTargetProps) {
  const t = useTranslations()
  const id = useId()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const addButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  function finish() {
    setAdding(false)
    setName('')
    setError(false)
    onCreatingChange?.(false)
    requestAnimationFrame(() => addButtonRef.current?.focus())
  }

  async function createTag() {
    if (disabled || savingRef.current || !name.trim()) return
    savingRef.current = true
    setSaving(true)
    setError(false)
    try {
      const create = onCreateTag ?? (await import('@/lib/record-save-target')).createRecordTag
      const tag = await create(name.trim())
      if (!mountedRef.current) return
      onTagChange(tag.id)
      finish()
    } catch {
      if (mountedRef.current) setError(true)
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  function selectTag(value: string) {
    // The form's native select can emit an empty value before a newly created
    // option is registered. Only actual tag options may change the selection.
    const tag = tags.find(item => String(item.id) === value)
    if (tag) onTagChange(tag.id)
  }

  return (
    <Field data-disabled={disabled} className="min-w-0 gap-1.5">
      <FieldLabel htmlFor={id}>{t('record.capture.saveTarget')}</FieldLabel>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          {mobile ? (
            <MobileSelectDrawer id={id} title={t('record.capture.saveTarget')}
              value={String(selectedTagId)} options={tags.map(tag => ({ value: String(tag.id), label: tag.name }))}
              onValueChange={selectTag}
              disabled={disabled || adding || tags.length === 0}
              placeholder={t('record.capture.saveTargetPlaceholder')} />
          ) : (
            <Select value={tags.some(tag => tag.id === selectedTagId) ? String(selectedTagId) : ''}
              disabled={disabled || adding || tags.length === 0}
              onValueChange={selectTag}>
              <SelectTrigger id={id} className="w-full min-w-0 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]_*]:truncate">
                <SelectValue placeholder={t('record.capture.saveTargetPlaceholder')} />
              </SelectTrigger>
              <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
                <SelectGroup>{tags.map(tag => (
                  <SelectItem key={tag.id} value={String(tag.id)}>
                    <span className="break-all whitespace-normal">{tag.name}</span>
                  </SelectItem>
                ))}</SelectGroup>
              </SelectContent>
            </Select>
          )}
        </div>
        <Button ref={addButtonRef} type="button" variant="outline" disabled={disabled || adding}
          onClick={() => { setAdding(true); onCreatingChange?.(true) }}>
          {t('record.mark.tag.newTag')}
        </Button>
      </div>
      {adding && (
        <Field data-invalid={error} className="gap-2" onKeyDown={event => {
          // Keep IME confirmation, Enter and Escape inside the tag editor.
          event.stopPropagation()
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
            event.preventDefault()
            void createTag()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            if (!savingRef.current) finish()
          }
        }}>
          <FieldLabel htmlFor={`${id}-name`} className="sr-only">{t('record.mark.tag.newTag')}</FieldLabel>
          <InputGroup>
            <InputGroupInput id={`${id}-name`} autoFocus value={name} disabled={disabled || saving}
              className="min-w-0"
              aria-invalid={error} aria-describedby={error ? `${id}-error` : undefined}
              placeholder={t('record.mark.tag.newTagPlaceholder')}
              onChange={event => { setName(event.target.value); setError(false) }} />
            <InputGroupAddon align="inline-end" className="shrink-0 gap-1">
              <InputGroupButton variant="default" disabled={disabled || saving || !name.trim()} onClick={() => void createTag()}>
                {saving && <Spinner data-icon="inline-start" />}
                {t('record.mark.tag.add')}
              </InputGroupButton>
              <InputGroupButton disabled={saving} onClick={finish}>{t('common.cancel')}</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {error && <FieldError id={`${id}-error`} role="alert">{t('common.error')}</FieldError>}
        </Field>
      )}
    </Field>
  )
}
