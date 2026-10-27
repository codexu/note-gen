"use client"

import { useMemo } from 'react'
import { defineCatalog, type Spec } from '@json-render/core'
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'
import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldContent, FieldGroup, FieldTitle } from '@/components/ui/field'

export interface ApprovalUiField {
  label: string
  value: string
  format: 'text' | 'content' | 'json'
}

export interface ApprovalUiWarning {
  message: string
  paths: string[]
}

export interface ApprovalUiModel {
  fields: ApprovalUiField[]
  warningTitle: string
  warnings: ApprovalUiWarning[]
}

// This catalog is authored by the host and never exposed to the model's tools.
const approvalCatalog = defineCatalog(schema, {
  components: {
    ApprovalDetails: { props: z.strictObject({}), slots: ['default'] },
    KeyValue: {
      props: z.strictObject({
        label: z.string(),
        value: z.string(),
        format: z.enum(['text', 'content', 'json']),
      }),
    },
    Warning: {
      props: z.strictObject({
        title: z.string(),
        items: z.array(z.strictObject({ message: z.string(), paths: z.array(z.string()) })),
      }),
    },
  },
  actions: {},
})

const { registry } = defineRegistry(approvalCatalog, {
  components: {
    ApprovalDetails: ({ children }) => <FieldGroup className="gap-3">{children}</FieldGroup>,
    KeyValue: ({ props }) => (
      <Field orientation="responsive" className="min-w-0 items-start">
        <FieldTitle className="min-w-0 shrink-0 break-words">{props.label}</FieldTitle>
        <FieldContent className="min-w-0">
          {props.format === 'text'
            ? <p className="whitespace-pre-wrap break-words">{props.value}</p>
            : <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{props.value}</pre>}
        </FieldContent>
      </Field>
    ),
    Warning: ({ props }) => (
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>{props.title}</AlertTitle>
        <AlertDescription>
          <ul className="flex list-inside list-disc flex-col gap-2">
            {props.items.map((item, index) => <li key={index}>
              {item.message}
              {item.paths.length > 0 && <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all">{item.paths.join('\n')}</pre>}
            </li>)}
          </ul>
        </AlertDescription>
      </Alert>
    ),
  },
})

function buildApprovalSpec(model: ApprovalUiModel): Spec {
  const children: string[] = []
  const spec: Spec = { root: 'details', elements: { details: { type: 'ApprovalDetails', props: {}, children } } }
  if (model.warnings.length) {
    children.push('warnings')
    spec.elements.warnings = { type: 'Warning', props: { title: model.warningTitle, items: model.warnings }, children: [] }
  }
  for (const [index, field] of model.fields.entries()) {
    const id = `field-${index}`
    children.push(id)
    spec.elements[id] = { type: 'KeyValue', props: { ...field }, children: [] }
  }
  return spec
}

export function ApprovalUi({ model }: { model: ApprovalUiModel }) {
  const spec = useMemo(() => buildApprovalSpec(model), [model])
  return <JSONUIProvider registry={registry} handlers={{}}><Renderer spec={spec} registry={registry} /></JSONUIProvider>
}
