import { defineCatalog, type Spec } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'
import { responseIconNames } from './response-icons'
import { RESPONSE_LIMITS } from './response-limits'

const safeId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
  .refine(value => !['constructor', 'prototype', '__proto__'].includes(value))
const nonBlank = (maxLength: number) => z.string().min(1).max(maxLength).refine(value => Boolean(value.trim()))
const icon = z.enum(responseIconNames).optional()
const shortText = z.string().max(1_000)
const reference = nonBlank(2_000)
const panel = z.strictObject({ title: nonBlank(200), content: z.string().max(12_000), icon })
const entry = { title: nonBlank(200), description: z.string().max(6_000).optional(), icon }
const actionBase = { label: nonBlank(100), icon }
export const responseActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...actionBase, type: z.literal('copy'), text: nonBlank(12_000) }),
  z.strictObject({ ...actionBase, type: z.literal('open-note'), path: reference }),
  z.strictObject({ ...actionBase, type: z.literal('open-source'), sourceKey: reference }),
  z.strictObject({ ...actionBase, type: z.literal('open-artifact'), path: reference }),
  z.strictObject({ ...actionBase, type: z.literal('save-artifact'), path: reference }),
])
export type ResponseAction = z.infer<typeof responseActionSchema>

const definitions = {
  Stack: {
    props: z.strictObject({ gap: z.enum(['sm', 'md', 'lg']).optional() }),
    slots: ['default'], description: 'Arrange reply content vertically in tree order.',
  },
  Card: {
    props: z.strictObject({ title: z.string().max(200).optional(), description: z.string().max(1_000).optional(), icon, variant: z.enum(['plain', 'outlined']).optional() }),
    slots: ['default'], description: 'Borderless content by default (plain). Use outlined only for a meaningful standalone card. Use Heading and Stack for ordinary sections; avoid nested card frames.',
  },
  Text: { props: z.strictObject({ text: z.string().max(6_000) }), description: 'Read-only plain text.' },
  Markdown: { props: z.strictObject({ text: z.string().max(12_000) }), description: 'Read-only Markdown rendered with the existing NoteGen renderer.' },
  Heading: {
    props: z.strictObject({ text: nonBlank(200), level: z.number().int().min(2).max(4).optional(), icon }),
    description: 'A reply heading at level 2, 3 or 4; defaults to level 3.',
  },
  List: {
    props: z.strictObject({ items: z.array(nonBlank(2_000)).min(1).max(100), ordered: z.boolean().optional() }),
    description: 'A read-only list of plain text items, optionally numbered.',
  },
  Table: {
    props: z.strictObject({
      columns: z.array(nonBlank(200)).min(1).max(12),
      rows: z.array(z.array(z.string().max(2_000)).min(1).max(12)).max(100),
    }),
    description: 'A read-only table. Each row must have exactly one plain text cell per column.',
  },
  Icon: { props: z.strictObject({ name: z.enum(responseIconNames), label: nonBlank(200), size: z.enum(['sm', 'md', 'lg']).optional() }), description: 'A labelled Lucide icon. Prefer optional icon props for decorative icons on other components.' },
  Alert: { props: z.strictObject({ title: nonBlank(200), description: shortText.optional(), variant: z.enum(['default', 'warning', 'destructive']).optional(), icon }), slots: ['default'], description: 'Important information or cautions; supports rich child content.' },
  Badge: { props: z.strictObject({ text: nonBlank(100), variant: z.enum(['default', 'secondary', 'outline', 'success', 'warning', 'info', 'destructive']).optional(), icon }), description: 'A concise label, category or evidence-backed status.' },
  KeyValue: { props: z.strictObject({ title: shortText.optional(), items: z.array(z.strictObject({ label: nonBlank(200), value: z.string().max(2_000), icon })).min(1).max(40) }), description: 'A compact attribute/value summary. Values are plain text.' },
  Stat: { props: z.strictObject({ label: nonBlank(200), value: nonBlank(200), description: shortText.optional(), icon }), description: 'An evidence-backed number or metric, with its label and optional context.' },
  Steps: { props: z.strictObject({ items: z.array(z.strictObject({ ...entry, status: z.enum(['pending', 'current', 'done']).optional() })).min(1).max(30) }), description: 'Ordered instructions or steps. Description supports Markdown; only assert status when supported by evidence.' },
  Timeline: { props: z.strictObject({ items: z.array(z.strictObject({ ...entry, time: z.string().max(200).optional() })).min(1).max(30) }), description: 'Events in order, with optional time labels and Markdown descriptions.' },
  Accordion: { props: z.strictObject({ items: z.array(panel).min(1).max(12), defaultOpen: z.array(z.number().int().min(0).max(11)).max(12).optional() }), description: 'Expandable sections; each item has title, Markdown content and optional icon. defaultOpen contains zero-based item indices.' },
  Tabs: { props: z.strictObject({ items: z.array(panel).min(1).max(12), defaultIndex: z.number().int().min(0).max(11).optional() }), description: 'Switch between related views. Each item has title, Markdown content and optional icon. defaultIndex is zero-based.' },
  Math: { props: z.strictObject({ latex: nonBlank(12_000), displayMode: z.boolean().optional(), label: shortText.optional() }), description: 'KaTeX formula. Pass raw LaTeX without dollar delimiters; JSON backslashes must be escaped. Defaults to block display.' },
  CodeBlock: { props: z.strictObject({ code: nonBlank(16_000), language: z.string().regex(/^[a-zA-Z0-9_+-]{1,40}$/).optional(), title: shortText.optional() }), description: 'Syntax-highlighted code with the existing NoteGen copy control. No Markdown fences in code.' },
  Quote: { props: z.strictObject({ text: nonBlank(6_000), attribution: shortText.optional(), sourceKey: reference.optional() }), description: 'An exact quotation with optional attribution and a real knowledge source key.' },
  Sources: { props: z.strictObject({ title: shortText.optional(), items: z.array(z.strictObject({ sourceKey: reference, label: nonBlank(200) })).min(1).max(30) }), description: 'Actual cited knowledge sources. Use sourceKey returned by knowledge tools; labels are descriptive, not invented source IDs.' },
  Image: { props: z.strictObject({ src: nonBlank(4_000), alt: nonBlank(500), caption: shortText.optional() }), description: 'Image from an HTTPS URL or an exact runtime-scanned image artifact path. Never use arbitrary local paths or data URLs.' },
  NoteLink: { props: z.strictObject({ path: reference, label: shortText.optional(), icon }), description: 'Open a real workspace-relative Markdown note. Never invent a path; only opens in the response workspace.' },
  ArtifactLink: { props: z.strictObject({ path: reference, label: shortText.optional(), icon }), description: 'Open or save an exact artifact path returned by runtime output tools; arbitrary local paths are unavailable.' },
  Progress: { props: z.strictObject({ label: nonBlank(200), value: z.number().min(0).max(100), description: shortText.optional() }), description: 'A known percentage from 0 to 100. Never fabricate execution progress.' },
  Separator: { props: z.strictObject({}), description: 'A horizontal divider between groups.' },
  ActionGroup: { props: z.strictObject({ actions: z.array(responseActionSchema).min(1).max(8) }), description: 'User-triggered host actions: copy text, open-note, open-source, open-artifact or save-artifact. Cannot approve, write files, execute code or make requests.' },

}

export const responseCatalog = defineCatalog(schema, { components: definitions, actions: {} })
export type ResponseComponentProps<T extends keyof typeof definitions> = z.infer<(typeof definitions)[T]['props']>
const layoutTypes = new Set(['Stack', 'Card', 'Alert'])
const nodeSchema = <T extends keyof typeof definitions>(type: T) => z.strictObject({
  type: z.literal(type),
  props: definitions[type].props,
  children: z.array(safeId).max(layoutTypes.has(type) ? RESPONSE_LIMITS.children : 0).optional(),
})
const responseElementSchema = z.discriminatedUnion('type', [
    nodeSchema('Stack'), nodeSchema('Card'), nodeSchema('Text'), nodeSchema('Markdown'),
    nodeSchema('Heading'), nodeSchema('List'), nodeSchema('Table'),
    nodeSchema('Icon'), nodeSchema('Alert'), nodeSchema('Badge'), nodeSchema('KeyValue'),
    nodeSchema('Stat'), nodeSchema('Steps'), nodeSchema('Timeline'), nodeSchema('Accordion'),
    nodeSchema('Tabs'), nodeSchema('Math'), nodeSchema('CodeBlock'), nodeSchema('Quote'),
    nodeSchema('Sources'), nodeSchema('Image'), nodeSchema('NoteLink'), nodeSchema('ArtifactLink'),
    nodeSchema('Progress'), nodeSchema('Separator'), nodeSchema('ActionGroup'),
  ])
const responseElementsSchema = z.record(safeId, responseElementSchema)
const responseSpecSchema = z.strictObject({
  root: safeId,
  elements: responseElementsSchema,
})

export const responseSpecJsonSchema = z.toJSONSchema(responseSpecSchema, {
  override: ({ zodSchema, jsonSchema }) => {
    if (zodSchema === responseElementsSchema) {
      jsonSchema.minProperties = 1
      jsonSchema.maxProperties = RESPONSE_LIMITS.elements
    }
  },
})

export const isChatResponseElementId = (value: unknown): value is string => safeId.safeParse(value).success

export function parseChatResponseElement(input: unknown): Spec['elements'][string] {
  const element = responseElementSchema.parse(input)
  return { type: element.type, props: element.props, children: element.children ?? [] }
}

export function isResponseNotePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f:]/.test(value)) return false
  const path = value.replace(/\\/g, '/').replace(/^\.\//, '')
  return !path.startsWith('/') && /\.md$/i.test(path)
    && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

export function isResponseImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch { return false }
}

/** Resolve semantic references against recorded host data before publishing a reply. */
export function validateChatResponseReferences(spec: Spec, sources: ReadonlySet<string>, artifacts: ReadonlySet<string>): void {
  const source = (key: string) => { if (!sources.has(key)) throw new Error(`Unknown cited source: ${key}`) }
  const artifact = (path: string) => { if (!artifacts.has(path)) throw new Error(`Unknown runtime artifact: ${path}`) }
  for (const element of Object.values(spec.elements)) {
    if (element.type === 'Quote') {
      const props = definitions.Quote.props.parse(element.props)
      if (props.sourceKey) source(props.sourceKey)
    } else if (element.type === 'Sources') {
      for (const item of definitions.Sources.props.parse(element.props).items) source(item.sourceKey)
    } else if (element.type === 'ArtifactLink') {
      artifact(definitions.ArtifactLink.props.parse(element.props).path)
    } else if (element.type === 'Image') {
      const { src } = definitions.Image.props.parse(element.props)
      if (!isResponseImageUrl(src)) {
        artifact(src)
        if (!/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(src)) throw new Error('Image must reference an image artifact.')
      }
    } else if (element.type === 'ActionGroup') {
      for (const action of definitions.ActionGroup.props.parse(element.props).actions) {
        if (action.type === 'open-source') source(action.sourceKey)
        if (action.type === 'open-artifact' || action.type === 'save-artifact') artifact(action.path)
      }
    }
  }
}

export function getChatResponseNotePaths(spec: Spec): string[] {
  const paths = new Set<string>()
  for (const element of Object.values(spec.elements)) {
    if (element.type === 'NoteLink') paths.add(definitions.NoteLink.props.parse(element.props).path)
    if (element.type === 'ActionGroup') {
      for (const action of definitions.ActionGroup.props.parse(element.props).actions) {
        if (action.type === 'open-note') paths.add(action.path)
      }
    }
  }
  return [...paths]
}

export function parseChatResponseSpec(input: unknown): Spec {
  const serialized = JSON.stringify(input)
  if (!serialized) throw new Error('Reply UI spec is missing.')
  if (serialized.length > RESPONSE_LIMITS.specChars) {
    throw new Error(`Reply UI spec has ${serialized.length} serialized characters; maximum is ${RESPONSE_LIMITS.specChars}. Shorten content and remove redundant wrappers, then retry with the complete answer.`)
  }
  const parsed = responseSpecSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  const ids = Object.keys(parsed.data.elements)
  if (!ids.length || ids.length > RESPONSE_LIMITS.elements) {
    throw new Error(`Reply UI has ${ids.length} elements; use 1–${RESPONSE_LIMITS.elements}. Reuse Card title/description and item arrays instead of separate wrappers for every field, then retry with the complete answer.`)
  }
  const elements: Spec['elements'] = {}
  for (const [id, element] of Object.entries(parsed.data.elements)) {
    if (element.type === 'Math') {
      const { latex } = definitions.Math.props.parse(element.props)
      if (/^\s*(?:\$|\\\[|\\\()|(?:\$|\\\]|\\\))\s*$/.test(latex)) throw new Error(`${id}: Math.latex must contain raw LaTeX without math delimiters.`)
    }
    if (element.type === 'Table') {
      const table = definitions.Table.props.parse(element.props)
      if (table.rows.some(row => row.length !== table.columns.length)) {
        throw new Error(`${id}: every table row must have exactly ${table.columns.length} cells.`)
      }
    }
    if (element.type === 'Tabs') {
      const props = definitions.Tabs.props.parse(element.props)
      if ((props.defaultIndex ?? 0) >= props.items.length) throw new Error(`${id}: defaultIndex is outside the tabs.`)
    }
    if (element.type === 'Accordion') {
      const props = definitions.Accordion.props.parse(element.props)
      const indices = props.defaultOpen ?? []
      if (new Set(indices).size !== indices.length || indices.some(index => index >= props.items.length)) throw new Error(`${id}: invalid defaultOpen indices.`)
    }
    if (element.type === 'NoteLink') {
      const props = definitions.NoteLink.props.parse(element.props)
      if (!isResponseNotePath(props.path)) throw new Error(`${id}: use a workspace-relative Markdown note path.`)
    }
    if (element.type === 'ActionGroup') {
      const props = definitions.ActionGroup.props.parse(element.props)
      if (props.actions.some(action => action.type === 'open-note' && !isResponseNotePath(action.path))) throw new Error(`${id}: use a workspace-relative Markdown note path.`)
    }
    elements[id] = { type: element.type, props: element.props, children: element.children ?? [] }
  }
  const visited = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (!Object.hasOwn(elements, id) || visited.has(id) || depth > RESPONSE_LIMITS.depth) {
      throw new Error(`Reply UI must be one tree without missing, repeated or cyclic elements, with depth at most ${RESPONSE_LIMITS.depth}.`)
    }
    visited.add(id)
    for (const child of elements[id].children ?? []) visit(child, depth + 1)
  }
  visit(parsed.data.root, 0)
  if (visited.size !== ids.length) throw new Error('All reply UI elements must be reachable from root.')
  const spec: Spec = { root: parsed.data.root, elements }
  if (!responseCatalog.validate(spec).success) throw new Error('Reply UI does not match the response component catalog.')
  getChatResponseText(spec)
  return spec
}

const markdownSpecials = new Set('\\`*_{}[]()<>#+-.!|$'.split(''))

function plainText(text: string): string {
  return Array.from(text.replace(/\r\n?/g, '\n'))
    .map(character => markdownSpecials.has(character) ? `\\${character}` : character)
    .join('')
}

export function getResponseCodeFence(code: string, language = ''): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map(value => value.length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${code}\n${fence}`
}

/** Complete Markdown projection of the actual reply tree, shared by copy/export/history. */
export function getChatResponseText(spec: Spec): string {
  // One Table/List/etc. node can expand into many DOM items without increasing element count.
  let collectionItems = 0
  for (const element of Object.values(spec.elements)) {
    if (element.type === 'Table') {
      const { columns, rows } = definitions.Table.props.parse(element.props)
      collectionItems += columns.length + rows.reduce((count, row) => count + row.length, 0)
    } else if (['List', 'KeyValue', 'Steps', 'Timeline', 'Accordion', 'Tabs', 'Sources'].includes(element.type)) {
      if (Array.isArray(element.props.items)) collectionItems += element.props.items.length
    } else if (element.type === 'ActionGroup' && Array.isArray(element.props.actions)) {
      collectionItems += element.props.actions.length
    }
    if (collectionItems > RESPONSE_LIMITS.collectionItems) {
      throw new Error(`Reply UI exceeds ${RESPONSE_LIMITS.collectionItems} total collection items/table cells. Summarize large collections before rendering.`)
    }
  }
  const visited = new Set<string>()
  let hasContent = false
  const text = (value: unknown) => {
    const result = typeof value === 'string' ? value : ''
    if (result.trim()) hasContent = true
    return result
  }
  const project = (id: string, depth: number): string => {
    if (!Object.hasOwn(spec.elements, id) || visited.has(id) || visited.size >= RESPONSE_LIMITS.elements || depth > RESPONSE_LIMITS.depth) {
      throw new Error('Cannot project an invalid reply tree.')
    }
    visited.add(id)
    const element = spec.elements[id]
    const children = () => (element.children ?? []).map(child => project(child, depth + 1)).filter(Boolean)
    switch (element.type) {
      case 'Stack':
        return children().join('\n\n')
      case 'Card': {
        const title = text(element.props.title)
        const description = text(element.props.description)
        return [
          title.trim() ? `**${plainText(title.trim())}**` : '',
          description.trim() ? plainText(description).replace(/\n/g, '  \n') : '',
          ...children(),
        ].filter(Boolean).join('\n\n')
      }
      case 'Alert': {
        const props = definitions.Alert.props.parse(element.props)
        return [`**${plainText(text(props.title))}**`, plainText(text(props.description)), ...children()].filter(Boolean).join('\n\n')
      }
      case 'Icon':
        return plainText(text(element.props.label))
      case 'Badge':
        return plainText(text(element.props.text))
      case 'KeyValue': {
        const props = definitions.KeyValue.props.parse(element.props)
        return [plainText(text(props.title)), ...props.items.map(item => `- **${plainText(text(item.label))}**: ${plainText(text(item.value))}`)].filter(Boolean).join('\n')
      }
      case 'Stat': {
        const props = definitions.Stat.props.parse(element.props)
        return [`**${plainText(text(props.label))}**: ${plainText(text(props.value))}`, plainText(text(props.description))].filter(Boolean).join('\n\n')
      }
      case 'Steps': {
        const props = definitions.Steps.props.parse(element.props)
        return props.items.map((item, index) => `${index + 1}. **${plainText(text(item.title))}**${item.status ? ` (${item.status})` : ''}${item.description ? `\n\n${text(item.description)}` : ''}`).join('\n\n')
      }
      case 'Timeline': {
        const props = definitions.Timeline.props.parse(element.props)
        return props.items.map(item => `- ${item.time ? `${plainText(text(item.time))} — ` : ''}**${plainText(text(item.title))}**${item.description ? `\n\n${text(item.description)}` : ''}`).join('\n\n')
      }
      case 'Accordion':
      case 'Tabs': {
        const props = element.type === 'Tabs' ? definitions.Tabs.props.parse(element.props) : definitions.Accordion.props.parse(element.props)
        return props.items.map(item => `### ${plainText(text(item.title))}\n\n${text(item.content)}`).join('\n\n')
      }
      case 'Math': {
        const props = definitions.Math.props.parse(element.props)
        const latex = text(props.latex)
        return [plainText(text(props.label)), props.displayMode === false ? `$${latex}$` : `$$\n${latex}\n$$`].filter(Boolean).join('\n\n')
      }
      case 'CodeBlock': {
        const props = definitions.CodeBlock.props.parse(element.props)
        const code = text(props.code)
        return [plainText(text(props.title)), getResponseCodeFence(code, props.language)].filter(Boolean).join('\n\n')
      }
      case 'Quote': {
        const props = definitions.Quote.props.parse(element.props)
        return [`> ${plainText(text(props.text)).replace(/\n/g, '\n> ')}`, plainText(text(props.attribution)), props.sourceKey ? `[${plainText(text(props.sourceKey))}]` : ''].filter(Boolean).join('\n\n')
      }
      case 'Sources': {
        const props = definitions.Sources.props.parse(element.props)
        return [plainText(text(props.title)), ...props.items.map(item => `- ${plainText(text(item.label))} (${plainText(text(item.sourceKey))})`)].filter(Boolean).join('\n')
      }
      case 'Image': {
        const props = definitions.Image.props.parse(element.props)
        return [`![${plainText(text(props.alt))}](${encodeURI(props.src).replace(/\(/g, '%28').replace(/\)/g, '%29')})`, plainText(text(props.caption))].filter(Boolean).join('\n\n')
      }
      case 'NoteLink':
      case 'ArtifactLink': {
        const props = element.type === 'NoteLink' ? definitions.NoteLink.props.parse(element.props) : definitions.ArtifactLink.props.parse(element.props)
        return `[${plainText(text(props.label || props.path.split(/[\\/]/).pop() || props.path))}](${encodeURI(props.path).replace(/\(/g, '%28').replace(/\)/g, '%29')})`
      }
      case 'Progress': {
        const props = definitions.Progress.props.parse(element.props)
        return [`${plainText(text(props.label))}: ${props.value}%`, plainText(text(props.description))].filter(Boolean).join('\n\n')
      }
      case 'Separator':
        return '---'
      case 'ActionGroup': {
        const props = definitions.ActionGroup.props.parse(element.props)
        return props.actions.map(action => `- ${plainText(text(action.label))}: ${action.type === 'copy' ? plainText(text(action.text)) : plainText(text(action.type === 'open-source' ? action.sourceKey : action.path))}`).join('\n')
      }
      case 'Text':
        return plainText(text(element.props.text)).replace(/\n/g, '  \n')
      case 'Markdown':
        return text(element.props.text)
      case 'Heading': {
        const heading = text(element.props.text).trim().replace(/\r?\n/g, ' ')
        const level = element.props.level === 2 ? 2 : element.props.level === 4 ? 4 : 3
        return heading ? `${'#'.repeat(level)} ${plainText(heading)}` : ''
      }
      case 'List': {
        const list = definitions.List.props.parse(element.props)
        return list.items.map((item, index) => {
          const prefix = list.ordered ? `${index + 1}. ` : '- '
          const lines = plainText(text(item)).split('\n')
          return `${prefix}${lines[0]}${lines.slice(1).map(line => `\n${' '.repeat(prefix.length)}${line}`).join('')}`
        }).join('\n')
      }
      case 'Table': {
        const table = definitions.Table.props.parse(element.props)
        if (table.rows.some(row => row.length !== table.columns.length)) throw new Error('Table row width does not match its columns.')
        const row = (cells: string[]) => `| ${cells.map(cell => plainText(text(cell)).replace(/\n/g, ' ')).join(' | ')} |`
        return [row(table.columns), `| ${table.columns.map(() => '---').join(' | ')} |`, ...table.rows.map(row)].join('\n')
      }
      default:
        throw new Error(`Unsupported reply component: ${element.type}`)
    }
  }
  const result = project(spec.root, 0).trim()
  if (!hasContent || !result) throw new Error('The final reply must contain visible content.')
  return result
}
