'use client'

import { useEffect, useId } from 'react'
import { useTranslations } from 'next-intl'
import type { PluginFormBlock, PluginFormField, PluginFormValue } from '@notegen/plugin-api'
import { PluginNotePicker } from './plugin-note-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { executePluginCommand } from '@/lib/plugins/command-registry'
import { usePluginFormStore, pluginFormKey, reconcilePluginForm, patchPluginForm } from '@/lib/plugins/form-state'

function visible(field: PluginFormField, values: Record<string, PluginFormValue>): boolean {
  return !field.visibleWhen || values[field.visibleWhen.field] === field.visibleWhen.equals
}

export function PluginForm({ block, scope }: { block: PluginFormBlock; scope: string }) {
  const t = useTranslations('settings.plugins.ui')
  const prefix = useId()
  const key = pluginFormKey(scope, block.id)
  const session = usePluginFormStore(state => state.sessions[key])
  const values = session?.values ?? Object.fromEntries(block.fields.map(field => [field.id, field.value ?? (field.type === 'checkbox' ? false : '')]))
  const errors = session?.errors ?? {}
  const message = session?.message ?? ''
  const failure = session?.failure ?? ''
  const busy = session?.busy ?? false
  useEffect(() => { reconcilePluginForm(scope, block) }, [scope, block])
  useEffect(() => {
    if (!block.changeCommand || !session || session.busy || session.changeRevision <= session.notifiedRevision) return
    const command = block.changeCommand
    const generation = session.generation
    const revision = session.changeRevision
    const timer = setTimeout(() => {
      const current = usePluginFormStore.getState().sessions[key]
      if (!current || current.generation !== generation || current.changeRevision !== revision || current.notifiedRevision >= revision) return
      patchPluginForm(key, generation, { notifiedRevision: revision })
      const dialogId = scope.split(':')[1] === 'dialog' ? scope.split(':')[2] : undefined
      void executePluginCommand(command, {
        formId: block.id, fieldId: current.changedField ?? '', values: current.values,
        revision, generation, ...(dialogId ? { dialogId } : {}),
      }).catch(error => {
        const latest = usePluginFormStore.getState().sessions[key]
        if (latest?.generation === generation && latest.changeRevision === revision) {
          patchPluginForm(key, generation, { failure: error instanceof Error ? error.message : String(error) })
        }
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [block.changeCommand, block.id, key, scope, session])

  function update(id: string, value: PluginFormValue) {
    const current = reconcilePluginForm(scope, block)
    const field = block.fields.find(field => field.id === id)
    if (current.busy || !field || field.disabled || !visible(field, current.values)) return
    if (field.type === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) value = Number(value)
    patchPluginForm(key, current.generation, { values: { ...current.values, [id]: value }, errors: { ...current.errors, [id]: '' }, message: '', failure: '', changedField: id, changeRevision: current.changeRevision + 1 })
  }

  async function submit() {
    const current = reconcilePluginForm(scope, block)
    if (current.busy || block.submitDisabled) return
    const generation = current.generation
    const values = current.values
    const nextErrors: Record<string, string> = {}
    const submitted: Record<string, PluginFormValue> = {}
    for (const field of block.fields) {
      if (field.disabled || !visible(field, values)) continue
      const value = values[field.id]
      const empty = field.type === 'checkbox' ? value !== true : String(value ?? '').trim() === ''
      if (field.required && empty) { nextErrors[field.id] = t('requiredField'); continue }
      if (field.type === 'number') {
        if (empty) continue
        const numeric = Number(value)
        if (!Number.isFinite(numeric) || (field.min !== undefined && numeric < field.min) || (field.max !== undefined && numeric > field.max)) {
          nextErrors[field.id] = t('invalidValue'); continue
        }
        submitted[field.id] = numeric
      } else if (field.type === 'checkbox') submitted[field.id] = value === true
      else if (field.type === 'select' || field.type === 'note-picker') {
        if (empty && !field.required) continue
        if (!field.options.some(option => option.value === value)) { nextErrors[field.id] = t('invalidValue'); continue }
        submitted[field.id] = String(value)
      } else {
        const text = String(value ?? '')
        const maxLength = 'maxLength' in field ? field.maxLength ?? 10_000 : 10_000
        if (text.length > maxLength || (field.type === 'date' && text !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text))) { nextErrors[field.id] = t('invalidValue'); continue }
        submitted[field.id] = text
      }
    }
    patchPluginForm(key, generation, { errors: nextErrors, failure: '', message: '' })
    if (Object.keys(nextErrors).length) return
    patchPluginForm(key, generation, { busy: true })
    try {
      const dialogId = scope.split(':')[1] === 'dialog' ? scope.split(':')[2] : undefined
      const result = await executePluginCommand(block.command, { formId: block.id, values: submitted, ...(dialogId ? { dialogId } : {}) })
      if (usePluginFormStore.getState().sessions[key]?.generation !== generation) return
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        if ('fieldErrors' in result && result.fieldErrors && typeof result.fieldErrors === 'object' && !Array.isArray(result.fieldErrors)) {
          const fieldErrors = result.fieldErrors
          patchPluginForm(key, generation, { errors: Object.fromEntries(Object.entries(fieldErrors).filter(([key, error]) => (
            block.fields.some(field => field.id === key) && typeof error === 'string'
          )).map(([key, error]) => [key, String(error).slice(0, 500)])) })
        }
        if ('message' in result && typeof result.message === 'string') patchPluginForm(key, generation, { message: result.message.slice(0, 2_000) })
      }
    } catch (error) {
      patchPluginForm(key, generation, { failure: error instanceof Error ? error.message : String(error) })
    } finally {
      patchPluginForm(key, generation, { busy: false })
    }
  }

  return <form aria-busy={busy} noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
    <FieldGroup>
      {block.fields.map(field => {
        if (!visible(field, values)) return null
        const id = `${prefix}-${field.id}`
        const invalid = Boolean(errors[field.id])
        const describedBy = [field.description ? `${id}-description` : null, invalid ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
        const disabled = busy || Boolean(field.disabled)
        if (field.type === 'checkbox') return (
          <Field key={field.id} orientation="horizontal" data-invalid={invalid} data-disabled={disabled}>
            <Checkbox id={id} checked={values[field.id] === true} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy} aria-required={field.required} onCheckedChange={value => update(field.id, value === true)} />
            <FieldContent>
              <FieldLabel htmlFor={id}>{field.label}{field.required ? ' *' : ''}</FieldLabel>
              {field.description ? <FieldDescription id={`${id}-description`}>{field.description}</FieldDescription> : null}
              <FieldError id={`${id}-error`}>{errors[field.id]}</FieldError>
            </FieldContent>
          </Field>
        )
        return <Field key={field.id} data-invalid={invalid} data-disabled={disabled}>
          <FieldLabel htmlFor={id}>{field.label}{field.required ? ' *' : ''}</FieldLabel>
          {field.type === 'note-picker' ? <PluginNotePicker id={id} label={field.label} options={field.options} value={String(values[field.id] ?? '')} disabled={disabled} invalid={invalid} describedBy={describedBy} onChange={value => update(field.id, value)} /> : field.type === 'select' ? <Select value={String(values[field.id] ?? '')} disabled={disabled} onValueChange={value => update(field.id, value)}>
              <SelectTrigger id={id} aria-invalid={invalid} aria-describedby={describedBy} aria-required={field.required}><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{field.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
              : field.type === 'textarea' ? <Textarea id={id} value={String(values[field.id] ?? '')} placeholder={field.placeholder} maxLength={field.maxLength ?? 10_000} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy} aria-required={field.required} onChange={event => update(field.id, event.target.value)} />
                : <Input id={id} type={field.type === 'number' ? 'number' : field.type === 'search' ? 'search' : field.type === 'date' ? 'date' : 'text'} value={String(values[field.id] ?? '')} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy} aria-required={field.required}
                  min={field.type === 'number' ? field.min : undefined} max={field.type === 'number' ? field.max : undefined} step={field.type === 'number' ? 'any' : undefined}
                  placeholder={'placeholder' in field ? field.placeholder : undefined} maxLength={'maxLength' in field ? field.maxLength ?? 10_000 : undefined}
                  onChange={event => update(field.id, event.target.value)} />}
          {field.description ? <FieldDescription id={`${id}-description`}>{field.description}</FieldDescription> : null}
          <FieldError id={`${id}-error`}>{errors[field.id]}</FieldError>
        </Field>
      })}
      <FieldError>{failure}</FieldError>
      {message ? <p role="status" className="whitespace-pre-wrap text-sm">{message}</p> : null}
      <Button type="submit" disabled={busy || block.submitDisabled} className="self-start">{busy ? <Spinner data-icon="inline-start" /> : null}{block.submitLabel}</Button>
    </FieldGroup>
  </form>
}
