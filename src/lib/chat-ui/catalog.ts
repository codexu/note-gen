import { defineCatalog, type Spec } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'
import type { ChatUiField, ChatUiRequest, ChatUiValues } from './types'
import { parseChatUiResultSpec } from './result-catalog'
import { parseChatResponseSpec } from './response-catalog'

const safeName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
  .refine(value => !['constructor', 'prototype', '__proto__'].includes(value))
const safeId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
  .refine(value => !['constructor', 'prototype', '__proto__'].includes(value))
const text = z.string().max(6_000)
const value = z.union([text, z.array(text).max(100)])
const field = {
  name: safeName,
  label: z.string().min(1).max(200),
  description: z.string().max(1_000).optional(),
  required: z.boolean().optional(),
  defaultValue: value.optional(),
}
const option = z.strictObject({ label: z.string().min(1).max(200), value: z.string().min(1).max(1_000) })
const options = z.array(option).min(1).max(100)
const definitions = {
  Stack: { props: z.strictObject({ gap: z.enum(['sm', 'md', 'lg']).optional() }), slots: ['default'], description: 'Vertical layout for fields and content.' },
  Card: { props: z.strictObject({ title: z.string().max(200).optional(), description: z.string().max(1_000).optional() }), slots: ['default'], description: 'Group related fields or information.' },
  Text: { props: z.strictObject({ text }), description: 'Plain text explanation or result.' },
  Input: { props: z.strictObject({ ...field, placeholder: z.string().max(200).optional() }), description: 'Single-line text field, for example a note title.' },
  Textarea: { props: z.strictObject({ ...field, placeholder: z.string().max(200).optional() }), description: 'Multiline text field for user instructions.' },
  Select: { props: z.strictObject({ ...field, options }), description: 'Select one of the supplied options.' },
  CheckboxGroup: { props: z.strictObject({ ...field, options }), description: 'Select multiple supplied options; defaultValue must be a string array.' },
  NotePicker: { props: z.strictObject({ ...field, multiple: z.boolean().optional() }), description: 'Search and select real workspace Markdown notes. Returns relative paths. Do not supply options.' },
  FolderPicker: { props: z.strictObject(field), description: 'Select an existing workspace directory. Returns its relative path, or a dot for the root directory.' },
  TagPicker: { props: z.strictObject({ ...field, multiple: z.boolean().optional() }), description: 'Select existing recording tags. Returns string tag IDs. Note files do not have recording tag IDs.' },
}

export const chatUiCatalog = defineCatalog(schema, { components: definitions, actions: {} })
const fieldTypes = new Set(['Input', 'Textarea', 'Select', 'CheckboxGroup', 'NotePicker', 'FolderPicker', 'TagPicker'])
const layoutTypes = new Set(['Stack', 'Card'])
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

const nodeSchema = <T extends keyof typeof definitions>(type: T) => z.strictObject({
  type: z.literal(type),
  props: definitions[type].props,
  children: z.array(safeId).max(layoutTypes.has(type) ? 64 : 0).optional(),
})
// The upstream catalog's generic propsOf schema does not discriminate props by component.
// Publish the same restricted vocabulary that the host actually accepts.
export const chatUiSpecSchema = z.strictObject({
  root: safeId,
  elements: z.record(z.string(), z.discriminatedUnion('type', [
    nodeSchema('Stack'), nodeSchema('Card'), nodeSchema('Text'), nodeSchema('Input'),
    nodeSchema('Textarea'), nodeSchema('Select'), nodeSchema('CheckboxGroup'),
    nodeSchema('NotePicker'), nodeSchema('FolderPicker'), nodeSchema('TagPicker'),
  ])),
})
export const chatUiSpecJsonSchema = z.toJSONSchema(chatUiSpecSchema)

/** Keep the first release's contract smaller than json-render's full expression/action language. */
export function parseChatUiSpec(input: unknown): Spec {
  if (!isRecord(input) || Object.keys(input).some(key => !['root', 'elements'].includes(key))) throw new Error('UI spec must contain only root and elements.')
  if (JSON.stringify(input).length > 48_000) throw new Error('UI spec is too large.')
  if (typeof input.root !== 'string' || !isRecord(input.elements)) throw new Error('UI spec needs a root element and an elements map.')
  const ids = Object.keys(input.elements)
  if (!ids.length || ids.length > 64 || ids.some(id => !safeId.safeParse(id).success)) throw new Error('Use 1–64 elements with simple alphanumeric IDs.')
  const elements: Spec['elements'] = {}
  const names = new Set<string>()
  for (const id of ids) {
    const element = input.elements[id]
    if (!isRecord(element) || Object.keys(element).some(key => !['type', 'props', 'children'].includes(key))) throw new Error('Elements support only type, props and children; actions and expressions are unavailable.')
    if (typeof element.type !== 'string' || !Object.hasOwn(definitions, element.type)) throw new Error(`Unknown UI component: ${String(element.type)}`)
    const definition = definitions[element.type as keyof typeof definitions]
    const parsed = definition.props.safeParse(element.props)
    if (!parsed.success) throw new Error(`${id}: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
    const props: Record<string, unknown> = parsed.data
    const children = element.children ?? []
    if (!Array.isArray(children) || children.some(child => typeof child !== 'string') || children.length > 64) throw new Error(`${id}: children must be element IDs.`)
    if (!layoutTypes.has(element.type) && children.length) throw new Error(`${id}: only Stack and Card may contain children.`)
    if (fieldTypes.has(element.type)) {
      const name = String(props.name)
      if (names.has(name)) throw new Error(`Duplicate field name: ${name}`)
      names.add(name)
      if (Array.isArray(props.options)) {
        const values = props.options.map(item => (item as { value: string }).value)
        if (new Set(values).size !== values.length) throw new Error(`${id}: option values must be unique.`)
      }
    }
    elements[id] = { type: element.type, props, children: children as string[] }
  }
  if (names.size > 20) throw new Error('A UI may contain at most 20 fields.')
  const visited = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (!Object.hasOwn(elements, id) || visited.has(id) || depth > 8) throw new Error('UI must be one tree, without missing, repeated or cyclic elements, with depth at most 8.')
    visited.add(id)
    for (const child of elements[id].children ?? []) visit(child, depth + 1)
  }
  visit(input.root, 0)
  if (visited.size !== ids.length) throw new Error('All UI elements must be reachable from root.')
  const spec: Spec = { root: input.root, elements }
  const validated = chatUiCatalog.validate(spec)
  if (!validated.success) throw new Error('UI spec does not match the component catalog.')
  const defaults = validateChatUiValues(spec, getChatUiInitialValues(spec), false)
  if (!defaults.success) throw new Error(`Invalid default field values: ${Object.keys(defaults.errors).join(', ')}`)
  return spec
}

export function parseChatUiRequest(input: unknown): ChatUiRequest {
  if (!isRecord(input) || (input.mode !== 'display' && input.mode !== 'collect')) throw new Error('mode must be display or collect.')
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200) throw new Error('Provide a non-empty title of at most 200 characters.')
  if (input.placement !== undefined && input.placement !== 'step' && input.placement !== 'result' && input.placement !== 'response') throw new Error('Unknown UI placement.')
  if (input.placement === 'response') {
    if (input.mode !== 'display') throw new Error('Final responses are read-only.')
    return { mode: 'display', placement: 'response', title: input.title.trim(), spec: parseChatResponseSpec(input.spec) }
  }
  if (input.placement === 'result') {
    if (input.mode !== 'display') throw new Error('Final results are read-only.')
    return { mode: 'display', placement: 'result', title: input.title.trim(), spec: parseChatUiResultSpec(input.spec) }
  }
  const spec = parseChatUiSpec(input.spec)
  if (input.mode === 'collect' && !getChatUiFields(spec).length) throw new Error('collect mode requires at least one input field.')
  return { mode: input.mode, title: input.title.trim(), spec }
}

export function getChatUiFields(spec: Spec): ChatUiField[] {
  const fields: ChatUiField[] = []
  const visit = (id: string) => {
    const element = spec.elements[id]
    if (!element) return
    if (fieldTypes.has(element.type)) {
      const props = element.props
      fields.push({
        name: String(props.name), label: String(props.label), type: element.type as ChatUiField['type'],
        required: props.required === true, multiple: element.type === 'CheckboxGroup' || props.multiple === true,
        options: props.options as ChatUiField['options'], defaultValue: props.defaultValue as ChatUiField['defaultValue'],
      })
    }
    for (const child of element.children ?? []) visit(child)
  }
  visit(spec.root)
  return fields
}

export function getChatUiInitialValues(spec: Spec): ChatUiValues {
  return Object.fromEntries(getChatUiFields(spec).map(field => [field.name, field.defaultValue ?? (field.multiple ? [] : '')]))
}

export function validateChatUiValues(spec: Spec, input: unknown, checkRequired = true): { success: boolean; errors: Record<string, string>; values: ChatUiValues } {
  const errors: Record<string, string> = {}
  const values: ChatUiValues = {}
  if (!isRecord(input)) return { success: false, errors: { _form: 'invalid' }, values }
  const fields = getChatUiFields(spec)
  const names = new Set(fields.map(field => field.name))
  if (Object.keys(input).some(name => !names.has(name))) errors._form = 'invalid'
  for (const field of fields) {
    const raw = input[field.name] ?? (field.multiple ? [] : '')
    if (field.multiple ? !Array.isArray(raw) || raw.length > 100 || raw.some(item => typeof item !== 'string' || item.length > 6_000) : typeof raw !== 'string' || raw.length > 6_000) {
      errors[field.name] = 'invalid'
      continue
    }
    const selected = Array.isArray(raw) ? raw as string[] : [raw as string]
    if (new Set(selected).size !== selected.length || (field.options && selected.some(item => item !== '' && !field.options!.some(option => option.value === item)))) {
      errors[field.name] = 'invalid'
      continue
    }
    if (checkRequired && field.required && (field.multiple ? !selected.length : !selected[0]?.trim())) errors[field.name] = 'required'
    values[field.name] = Array.isArray(raw) ? [...selected] : raw as string
  }
  return { success: Object.keys(errors).length === 0, errors, values }
}
