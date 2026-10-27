"use client"

import { useState, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { defineRegistry } from '@json-render/react'
import { chatUiCatalog } from '@/lib/chat-ui/catalog'
import type { ChatUiValue } from '@/lib/chat-ui/types'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { useChatUiForm } from './form-context'

interface FieldProps {
  name: string
  label: string
  description?: string | null
  required?: boolean | null
  defaultValue?: ChatUiValue | null
}

interface Option {
  label: string
  value: string
}

function FieldValidation({ name }: { name: string }) {
  const { errors } = useChatUiForm()
  const t = useTranslations('record.chat.input.agent.ui')
  return errors[name]
    ? <FieldError>{t(errors[name] === 'required' ? 'required' : 'invalid')}</FieldError>
    : null
}

function ReadonlyValue({ value, options = [] }: { value: ChatUiValue; options?: Option[] }) {
  const t = useTranslations('record.chat.input.agent.ui')
  const values = Array.isArray(value) ? value : value ? [value] : []
  const labels = values.map(item => options.find(option => option.value === item)?.label ?? item)
  return <p className="whitespace-pre-wrap break-words text-sm">{labels.length ? labels.join(' · ') : t('emptyValue')}</p>
}

function TextField({ multiline = false, ...props }: FieldProps & { multiline?: boolean; placeholder?: string | null }) {
  const form = useChatUiForm()
  const id = `${form.id}-${props.name}`
  const value = form.values[props.name] ?? ''
  const stringValue = typeof value === 'string' ? value : ''
  const common = {
    id,
    name: props.name,
    value: stringValue,
    placeholder: props.placeholder ?? undefined,
    required: Boolean(props.required),
    maxLength: 6_000,
    'aria-invalid': Boolean(form.errors[props.name]),
    'aria-describedby': props.description ? `${id}-description` : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => form.setValue(props.name, event.target.value),
  }
  return (
    <Field data-invalid={Boolean(form.errors[props.name])}>
      <FieldLabel htmlFor={id}>{props.label}{props.required ? ' *' : ''}</FieldLabel>
      {form.readOnly ? <ReadonlyValue value={value} /> : multiline ? <Textarea {...common} /> : <Input {...common} />}
      {props.description && <FieldDescription id={`${id}-description`}>{props.description}</FieldDescription>}
      <FieldValidation name={props.name} />
    </Field>
  )
}

function OptionsField({ options = [], multiple = false, searchable = false, ...props }: FieldProps & {
  options?: Option[]
  multiple?: boolean | null
  searchable?: boolean
}) {
  const form = useChatUiForm()
  const t = useTranslations('record.chat.input.agent.ui')
  const [query, setQuery] = useState('')
  const id = `${form.id}-${props.name}`
  const value = form.values[props.name] ?? (multiple ? [] : '')
  const selected = Array.isArray(value) ? value : value ? [value] : []
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || option.value.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const visible = filtered.slice(0, 100)
  const error = Boolean(form.errors[props.name])
  const label = <>{props.label}{props.required ? ' *' : ''}</>

  if (form.readOnly) return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <ReadonlyValue value={value} options={options} />
      {props.description && <FieldDescription>{props.description}</FieldDescription>}
    </Field>
  )

  return (
    <Field data-invalid={error}>
      {multiple ? (
        <FieldSet>
          <FieldLegend id={`${id}-label`} variant="label">{label}</FieldLegend>
          {searchable && <Input aria-label={t('searchLabel', { label: props.label })} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} disabled={form.domainLoading} />}
          {options.length > 0 && options.length <= 7 && !searchable ? (
            <ToggleGroup type="multiple" variant="outline" orientation="vertical" className="w-full" aria-labelledby={`${id}-label`} aria-invalid={error} value={selected} onValueChange={next => form.setValue(props.name, next)}>
              {options.map(option => <ToggleGroupItem key={option.value} value={option.value} className="h-auto min-h-9 justify-start whitespace-normal text-left">{option.label}</ToggleGroupItem>)}
            </ToggleGroup>
          ) : (
            <FieldGroup className="max-h-56 overflow-y-auto" data-slot="checkbox-group">
              {visible.map((option, index) => {
                const optionId = `${id}-option-${index}`
                return <Field key={option.value} orientation="horizontal">
                  <Checkbox id={optionId} checked={selected.includes(option.value)} aria-invalid={error} onCheckedChange={checked => form.setValue(props.name, checked === true ? [...selected, option.value] : selected.filter(item => item !== option.value))} />
                  <FieldLabel htmlFor={optionId} className="min-w-0 break-words">{option.label}</FieldLabel>
                </Field>
              })}
            </FieldGroup>
          )}
        </FieldSet>
      ) : (
        <>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {searchable && <Input aria-label={t('searchLabel', { label: props.label })} placeholder={t('search')} value={query} onChange={event => setQuery(event.target.value)} disabled={form.domainLoading} />}
          {options.length > 0 && options.length <= 7 && !searchable ? (
            <ToggleGroup id={id} type="single" variant="outline" orientation="vertical" className="w-full" aria-label={props.label} aria-invalid={error} value={typeof value === 'string' ? value : ''} onValueChange={next => form.setValue(props.name, next)}>
              {options.map(option => <ToggleGroupItem key={option.value} value={option.value} className="h-auto min-h-9 justify-start whitespace-normal text-left">{option.label}</ToggleGroupItem>)}
            </ToggleGroup>
          ) : (
            <Select value={typeof value === 'string' ? value : ''} onValueChange={next => form.setValue(props.name, next)} disabled={form.domainLoading || options.length === 0}>
              <SelectTrigger id={id} className="w-full" aria-invalid={error} aria-describedby={props.description ? `${id}-description` : undefined}>
                <SelectValue placeholder={t(form.domainLoading ? 'loading' : 'select')}>
                  {options.find(option => option.value === value)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent><SelectGroup>{visible.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          )}
        </>
      )}
      {!form.domainLoading && visible.length === 0 && <Empty className="p-3"><EmptyDescription>{t('noOptions')}</EmptyDescription></Empty>}
      {filtered.length > visible.length && <FieldDescription>{t('moreOptions')}</FieldDescription>}
      {form.domainLoading && searchable && <FieldDescription>{t('loading')}</FieldDescription>}
      {props.description && <FieldDescription id={`${id}-description`}>{props.description}</FieldDescription>}
      <FieldValidation name={props.name} />
    </Field>
  )
}

function DomainField({ kind, ...props }: FieldProps & { kind: 'notes' | 'folders' | 'tags'; multiple?: boolean | null }) {
  const { domainOptions } = useChatUiForm()
  const t = useTranslations('record.chat.input.agent.ui')
  const options = domainOptions[kind].map(option => ({ ...option, label: kind === 'folders' && option.value === '.' ? t('rootFolder') : option.label }))
  return <OptionsField {...props} options={options} searchable />
}

export const { registry: chatUiRegistry } = defineRegistry(chatUiCatalog, {
  components: {
    Stack: ({ props, children }) => <FieldGroup className={cn(props.gap === 'sm' && 'gap-2', props.gap === 'md' && 'gap-4', props.gap === 'lg' && 'gap-6')}>{children}</FieldGroup>,
    Card: ({ props, children }) => <Card size="sm">
      {(props.title || props.description) && <CardHeader>{props.title && <CardTitle>{props.title}</CardTitle>}{props.description && <CardDescription>{props.description}</CardDescription>}</CardHeader>}
      <CardContent>{children}</CardContent>
    </Card>,
    Text: ({ props }) => <p className="whitespace-pre-wrap break-words text-sm">{props.text}</p>,
    Input: ({ props }) => <TextField {...props} />,
    Textarea: ({ props }) => <TextField {...props} multiline />,
    Select: ({ props }) => <OptionsField {...props} />,
    CheckboxGroup: ({ props }) => <OptionsField {...props} multiple />,
    NotePicker: ({ props }) => <DomainField {...props} kind="notes" />,
    FolderPicker: ({ props }) => <DomainField {...props} kind="folders" />,
    TagPicker: ({ props }) => <DomainField {...props} kind="tags" />,
  },
})
