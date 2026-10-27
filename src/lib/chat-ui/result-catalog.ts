import { defineCatalog, type Spec } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'
import type { ResultEvidence } from './results'

// Retained only to read older saved result blocks. New final replies use response-catalog.
const safeId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
  .refine(value => !['constructor', 'prototype', '__proto__'].includes(value))
const referenceId = z.string().min(1).max(200)
const definitions = {
  Stack: {
    props: z.strictObject({ gap: z.enum(['sm', 'md', 'lg']).optional() }),
    slots: ['default'],
    description: 'Arrange task results vertically.',
  },
  Card: {
    props: z.strictObject({ title: z.string().max(200).optional(), description: z.string().max(1_000).optional() }),
    slots: ['default'],
    description: 'Group related result information.',
  },
  Text: { props: z.strictObject({ text: z.string().max(6_000) }), description: 'Plain text result explanation.' },
  Markdown: { props: z.strictObject({ text: z.string().max(12_000) }), description: 'Read-only Markdown explanation, rendered with NoteGen.' },
  Heading: {
    props: z.strictObject({ text: z.string().min(1).max(200), level: z.number().int().min(2).max(4).optional() }),
    description: 'A short heading for related results.',
  },
  NoteResult: {
    props: z.strictObject({ changeId: referenceId }),
    description: 'Reference an actual file/editor change ID. The app supplies its real path, operation and open action.',
  },
  OperationResult: {
    props: z.strictObject({ toolCallId: referenceId }),
    description: 'Reference an actual tool call ID. The app supplies its real operation status and result.',
  },
}

export const resultCatalog = defineCatalog(schema, { components: definitions, actions: {} })
const layoutTypes = new Set(['Stack', 'Card'])
const nodeSchema = <T extends keyof typeof definitions>(type: T) => z.strictObject({
  type: z.literal(type),
  props: definitions[type].props,
  children: z.array(safeId).max(layoutTypes.has(type) ? 64 : 0).optional(),
})
const resultSpecSchema = z.strictObject({
  root: safeId,
  elements: z.record(safeId, z.discriminatedUnion('type', [
    nodeSchema('Stack'), nodeSchema('Card'), nodeSchema('Text'), nodeSchema('Markdown'),
    nodeSchema('Heading'), nodeSchema('NoteResult'), nodeSchema('OperationResult'),
  ])),
})

export const resultSpecJsonSchema = z.toJSONSchema(resultSpecSchema)

export function parseChatUiResultSpec(input: unknown): Spec {
  const serialized = JSON.stringify(input)
  if (!serialized || serialized.length > 96_000) throw new Error('Result UI spec is missing or too large.')
  const parsed = resultSpecSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  }
  const ids = Object.keys(parsed.data.elements)
  if (!ids.length || ids.length > 64) throw new Error('A result UI must contain 1–64 elements.')
  const elements: Spec['elements'] = {}
  for (const [id, element] of Object.entries(parsed.data.elements)) {
    elements[id] = { type: element.type, props: element.props, children: element.children ?? [] }
  }
  const visited = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (!Object.hasOwn(elements, id) || visited.has(id) || depth > 8) {
      throw new Error('Result UI must be one tree without missing, repeated or cyclic elements, with depth at most 8.')
    }
    visited.add(id)
    for (const child of elements[id].children ?? []) visit(child, depth + 1)
  }
  visit(parsed.data.root, 0)
  if (visited.size !== ids.length) throw new Error('All result UI elements must be reachable from root.')
  const spec: Spec = { root: parsed.data.root, elements }
  if (!resultCatalog.validate(spec).success) throw new Error('Result UI does not match the result component catalog.')
  return spec
}

export function validateResultReferences(spec: Spec, evidence: ResultEvidence): void {
  for (const element of Object.values(spec.elements)) {
    if (element.type === 'NoteResult') {
      const change = evidence.changes.find(item => item.id === element.props.changeId)
      if (!change || (change.type !== 'file' && change.type !== 'editor')) {
        throw new Error(`NoteResult must reference an actual file/editor change: ${String(element.props.changeId)}`)
      }
    } else if (element.type === 'OperationResult') {
      const call = evidence.toolCalls.find(item => item.id === element.props.toolCallId)
      if (!call || ['show_ui', 'show_result', 'ask_user_question'].includes(call.toolName)) {
        throw new Error(`OperationResult must reference an actual operation tool call: ${String(element.props.toolCallId)}`)
      }
    }
  }
}
