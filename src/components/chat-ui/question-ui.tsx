"use client"

import { useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { defineCatalog, type Spec } from '@json-render/core'
import { defineRegistry, JSONUIProvider, Renderer, type Components } from '@json-render/react'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'
import { ArrowRight, Check } from 'lucide-react'
import type { AgentUserAnswer, AgentUserQuestion } from '@/lib/agent/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Host-only vocabulary: models never receive these callbacks as approval capabilities.
const questionCatalog = defineCatalog(schema, {
  components: {
    Stack: { props: z.object({}), slots: ['default'] },
    Question: {
      props: z.object({ labelId: z.string(), question: z.string(), multipleLabel: z.string(), position: z.number(), total: z.number(), status: z.string(), embedded: z.boolean() }),
      slots: ['default'],
    },
    Options: {
      props: z.object({ labelId: z.string(), multiple: z.boolean(), selected: z.array(z.string()), disabled: z.boolean(), readOnly: z.boolean() }),
      slots: ['default'],
    },
    Option: { props: z.object({ label: z.string(), description: z.string(), position: z.number(), selected: z.boolean(), selectedLabel: z.string(), multiple: z.boolean(), readOnly: z.boolean() }) },
    Actions: { props: z.object({}), slots: ['default'] },
    Action: { props: z.object({ label: z.string(), variant: z.enum(['ghost', 'default']), disabled: z.boolean(), next: z.boolean() }) },
    Summary: { props: z.object({ text: z.string() }) },
  },
  actions: {
    select_option: { params: z.object({ questionIndex: z.number().int(), option: z.string() }) },
    complete_question: { params: z.object({ questionIndex: z.number().int() }) },
    cancel_questions: { params: z.object({}) },
  },
})

const components: Components<typeof questionCatalog> = {
  Stack: ({ children }) => <FieldGroup>{children}</FieldGroup>,
  Question: ({ props, children }) => <Card size="sm" className={cn('w-full min-w-0 ring-inset', !props.embedded && 'mb-2')}>
    <CardHeader>
      <div className="flex flex-wrap items-center gap-2">
        {props.total > 1 && <Badge variant="outline">{props.position}/{props.total}</Badge>}
        <Badge variant="secondary">{props.multipleLabel}</Badge>
        {props.status && <Badge variant="outline">{props.status}</Badge>}
      </div>
      <CardTitle id={props.labelId} className="break-words" aria-live="polite">{props.question}</CardTitle>
    </CardHeader>
    <CardContent className="max-h-[45dvh] overflow-y-auto"><FieldGroup>{children}</FieldGroup></CardContent>
  </Card>,
  Options: ({ props, children }) => <Field data-disabled={props.disabled}>
    {props.readOnly ? <FieldGroup aria-labelledby={props.labelId}>{children}</FieldGroup> : props.multiple ? (
      <ToggleGroup type="multiple" variant="outline" orientation="vertical" className="w-full" aria-labelledby={props.labelId} value={props.selected} disabled={props.disabled}>{children}</ToggleGroup>
    ) : (
      <ToggleGroup type="single" variant="outline" orientation="vertical" className="w-full" aria-labelledby={props.labelId} value={props.selected[0] || ''} disabled={props.disabled}>{children}</ToggleGroup>
    )}
  </Field>,
  Option: ({ props, emit }) => {
    const content = <>
      <Badge variant="outline" aria-hidden="true">{props.position}</Badge>
      <span className="flex min-w-0 flex-1 flex-col gap-1 break-words">
        <span>{props.label}</span>
        {props.readOnly && props.selected && <span className="sr-only">{props.selectedLabel}</span>}
        {props.description && <span className="text-muted-foreground">{props.description}</span>}
      </span>
      {props.selected && (props.multiple || props.readOnly) && <Check aria-hidden="true" />}
    </>
    return props.readOnly ? (
      <div className="flex min-w-0 items-start gap-3" data-selected={props.selected}>{content}</div>
    ) : (
      <ToggleGroupItem value={props.label} className="h-auto min-h-11 w-full items-start justify-start gap-3 whitespace-normal px-3 py-3 text-left" onClick={() => emit('press')}>{content}</ToggleGroupItem>
    )
  },
  Actions: ({ children }) => <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>,
  Action: ({ props, emit }) => <Button type="button" variant={props.variant} size="sm" disabled={props.disabled} onClick={() => emit('press')}>
    {props.next && <ArrowRight data-icon="inline-start" />}{props.label}
  </Button>,
  Summary: ({ props }) => <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{props.text}</p>,
}

export interface QuestionUiProps {
  id: string
  questions: AgentUserQuestion[]
  answers: AgentUserAnswer[]
  questionIndex?: number
  disabled?: boolean
  readOnly?: boolean
  cancelled?: boolean
  embedded?: boolean
  onSelect?: (values: string[]) => void
  onAdvance?: () => void
  onCancel?: () => void
}

function createQuestionSpec(props: QuestionUiProps, labels: {
  single: string; multiple: string; done: string; cancel: string; submitted: string; cancelled: string; unanswered: string
}): Spec {
  const elements: Spec['elements'] = { root: { type: 'Stack', props: {}, children: [] } }
  const indexes = props.readOnly ? props.questions.map((_, index) => index) : [props.questionIndex ?? 0]
  for (const index of indexes) {
    const question = props.questions[index]
    if (!question) continue
    const selected = props.answers[index]?.selected ?? []
    const questionId = `question-${index}`
    const optionsId = `options-${index}`
    const labelId = `question-${props.id}-${index}`
    elements.root.children!.push(questionId)
    elements[questionId] = {
      type: 'Question',
      props: {
        labelId, question: question.question, multipleLabel: question.multiSelect ? labels.multiple : labels.single,
        position: index + 1, total: props.questions.length, embedded: Boolean(props.embedded),
        status: props.readOnly ? selected.length ? labels.submitted : props.cancelled ? labels.cancelled : labels.unanswered : '',
      },
      children: [optionsId],
    }
    elements[optionsId] = {
      type: 'Options', props: { labelId, multiple: question.multiSelect, selected, disabled: Boolean(props.disabled), readOnly: Boolean(props.readOnly) }, children: [],
    }
    question.options.forEach((option, optionIndex) => {
      const id = `option-${index}-${optionIndex}`
      elements[optionsId].children!.push(id)
      elements[id] = {
        type: 'Option',
        props: { label: option.label, description: option.description ?? '', position: optionIndex + 1, selected: selected.includes(option.label), selectedLabel: labels.submitted, multiple: question.multiSelect, readOnly: Boolean(props.readOnly) },
        ...(!props.readOnly ? { on: { press: { action: 'select_option', params: { questionIndex: index, option: option.label } } } } : {}),
      }
    })
    if (!props.readOnly) {
      const actionsId = `actions-${index}`
      elements[questionId].children!.push(actionsId)
      elements[actionsId] = { type: 'Actions', props: {}, children: ['cancel'] }
      elements.cancel = { type: 'Action', props: { label: labels.cancel, variant: 'ghost', disabled: Boolean(props.disabled), next: false }, on: { press: { action: 'cancel_questions', params: {} } } }
      if (question.multiSelect) {
        elements[actionsId].children!.push('complete')
        elements.complete = { type: 'Action', props: { label: labels.done, variant: 'default', disabled: Boolean(props.disabled) || !selected.length, next: true }, on: { press: { action: 'complete_question', params: { questionIndex: index } } } }
      }
    }
  }
  if (!elements.root.children!.length) elements.root = { type: 'Summary', props: { text: props.cancelled ? labels.cancelled : labels.unanswered } }
  return { root: 'root', elements }
}

/** Live selection and recorded answers share the same host-owned JSON vocabulary. */
export function QuestionUi(props: QuestionUiProps) {
  const t = useTranslations('record.chat.input.agent')
  const current = useRef(props)
  current.current = props
  const renderers = useMemo(() => defineRegistry(questionCatalog, {
    components,
    actions: {
      select_option: async params => {
        const latest = current.current
        if (!params || latest.readOnly || latest.disabled || params.questionIndex !== (latest.questionIndex ?? 0)) return
        const question = latest.questions[params.questionIndex]
        if (!question?.options.some(option => option.label === params.option)) return
        const selected = latest.answers[params.questionIndex]?.selected ?? []
        latest.onSelect?.(question.multiSelect
          ? selected.includes(params.option) ? selected.filter(option => option !== params.option) : [...selected, params.option]
          : [params.option])
      },
      complete_question: async params => {
        const latest = current.current
        if (params && !latest.readOnly && !latest.disabled && params.questionIndex === (latest.questionIndex ?? 0)) latest.onAdvance?.()
      },
      cancel_questions: async () => {
        const latest = current.current
        if (!latest.readOnly && !latest.disabled) latest.onCancel?.()
      },
    },
  }), [])
  const handlers = useMemo(() => renderers.handlers(() => undefined, () => ({})), [renderers])
  const spec = createQuestionSpec(props, {
    single: t('question.single'), multiple: t('question.multiple'), done: t('question.done'), cancel: t('ui.cancel'),
    submitted: t('ui.submitted'), cancelled: t('ui.cancelled'), unanswered: t('ui.emptyValue'),
  })
  return <JSONUIProvider registry={renderers.registry} handlers={handlers}>
    <Renderer spec={spec} registry={renderers.registry} />
  </JSONUIProvider>
}
