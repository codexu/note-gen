import { flattenExtensions, getExtensionField, type Editor, type JSONContent, type MarkdownTokenizer, type RawCommands } from '@tiptap/core'
import { Markdown, type MarkdownExtensionOptions } from '@tiptap/markdown'
import { Fragment, Mark, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import { createIsolatedMarkdownLexer, MARKDOWN_TOKENIZER_NAMES } from './markdown-tokenizers'
import type { PreparedMarkdownTokens } from './markdown-lexer-async'

/** Reuse background tokens through the public lexer boundary. Keep Tiptap's
 * extension handlers, DOM-dependent HTML parsing and schema normalization.
 */
export function parsePreparedMarkdown(editor: Editor, prepared: PreparedMarkdownTokens): JSONContent | null {
  const manager = editor.markdown
  if (!manager) return null
  if (prepared.tokenizerNames?.join('\n') !== MARKDOWN_TOKENIZER_NAMES.join('\n')) return null
  const tokenizerNames = flattenExtensions(editor.extensionManager.baseExtensions)
    .map(extension => getExtensionField<MarkdownTokenizer | undefined>(extension, 'markdownTokenizer')?.name)
    .filter((name): name is string => Boolean(name))
  if (tokenizerNames.join('\n') !== MARKDOWN_TOKENIZER_NAMES.join('\n')) return null

  const instance = manager.instance
  const lexer = instance.lexer
  const callLexer = lexer.bind(instance)
  let consumed = false
  instance.lexer = (source, options) => {
    if (!consumed && source === prepared.source) {
      consumed = true
      return prepared.tokens
    }
    return callLexer(source, options)
  }
  try {
    return manager.parse(prepared.source)
  } finally {
    instance.lexer = lexer
  }
}

function normalizeMarkdownNode(json: JSONContent, schema: Schema): ProseMirrorNode[] {
  const type = json.type ? schema.nodes[json.type] : undefined
  if (!type) {
    throw new Error(`Unknown Markdown node type: ${json.type ?? '(missing)'}`)
  }

  // Markdown can nest mutually exclusive marks (for example, italic around
  // inline code). Apply schema exclusions and deduplicate before doc.check().
  const marks = (json.marks ?? []).reduce<readonly Mark[]>(
    (set, mark) => schema.markFromJSON(mark).addToSet(set),
    Mark.none,
  )
  if (type.isText) {
    if (typeof json.text !== 'string' || json.content?.length) {
      throw new Error('Invalid Markdown text node')
    }
    return [schema.text(json.text, marks)]
  }

  let children = (json.content ?? []).flatMap(child => normalizeMarkdownNode(child, schema))
  if (type.isTextblock) {
    const nodes: ProseMirrorNode[] = []
    let inline: ProseMirrorNode[] = []
    const flushInline = () => {
      if (!inline.length) return
      nodes.push(type.createChecked(json.attrs, Fragment.fromArray(inline), marks))
      inline = []
    }

    // Markdown inline parsers can return block images or HTML blocks. Keep
    // their order without nesting them inside an inline-only paragraph/heading.
    for (const child of children) {
      if (child.isInline) {
        inline.push(child)
      } else {
        flushInline()
        nodes.push(child)
      }
    }
    flushInline()

    // Preserve explicitly empty textblocks, but do not leave an empty paragraph
    // around a block-only image. A list item can add its required paragraph below.
    if (!children.length) {
      nodes.push(type.createChecked(json.attrs, Fragment.empty, marks))
    }
    return nodes
  }

  // Loose/mixed Markdown list items can contain text directly beside headings,
  // quotes or nested lists. createAndFill only adds missing siblings; it cannot
  // wrap that inline content in the paragraphs required by a block container.
  if (!type.inlineContent && children.some(child => child.isInline)) {
    const paragraph = schema.nodes.paragraph
    if (!paragraph) {
      throw new Error('Markdown inline content requires a paragraph node')
    }
    const blocks: ProseMirrorNode[] = []
    let inline: ProseMirrorNode[] = []
    const flushInline = () => {
      if (!inline.length) return
      blocks.push(paragraph.createChecked(null, Fragment.fromArray(inline)))
      inline = []
    }
    for (const child of children) {
      if (child.isInline) {
        inline.push(child)
      } else {
        flushInline()
        blocks.push(child)
      }
    }
    flushInline()
    children = blocks
  }

  // Add required schema children (for example, the first paragraph of a list
  // item) while retaining every parsed child. Unfittable content must reach the
  // editor's source-mode fallback instead of being discarded.
  const node = type.createAndFill(json.attrs, Fragment.fromArray(children), marks)
  if (!node) {
    throw new Error(`Invalid Markdown content for node: ${type.name}`)
  }
  return [node]
}

function normalizeMarkdownDocument(json: JSONContent, schema: Schema): JSONContent {
  if (json.type !== schema.topNodeType.name) {
    throw new Error('Markdown parser did not return a document')
  }
  const nodes = normalizeMarkdownNode(json, schema)
  const doc = nodes[0]
  if (nodes.length !== 1 || doc.type !== schema.topNodeType) {
    throw new Error('Markdown parser returned an invalid document')
  }
  doc.check()
  return doc.toJSON()
}

function isEmptyMarkdown(value: unknown, options?: { contentType?: string }): boolean {
  return options?.contentType === 'markdown' && typeof value === 'string' && !value.trim()
}

export const SchemaMarkdown = Markdown.extend({
  addCommands() {
    const commands = this.parent?.() ?? {}
    return {
      ...commands,
      // A complete empty document needs a paragraph, but an empty insertion
      // should leave the document and the current selection unchanged.
      insertContent: (...args: Parameters<RawCommands['insertContent']>) => {
        if (isEmptyMarkdown(args[0], args[1])) return () => true
        return commands.insertContent?.(...args) ?? (() => false)
      },
      insertContentAt: (...args: Parameters<RawCommands['insertContentAt']>) => {
        if (isEmptyMarkdown(args[1], args[2])) return () => true
        return commands.insertContentAt?.(...args) ?? (() => false)
      },
    }
  },

  onBeforeCreate(event) {
    // Custom tokenizer registrations accumulate on the default global marked
    // singleton. Give each editor its own registry before the parent creates
    // the manager, so opening more documents does not slow down later parses.
    if (!this.options.marked) {
      // The manager uses the instance API; upstream types require the callable
      // singleton shape even though it never invokes it as a function.
      this.options.marked = createIsolatedMarkdownLexer() as unknown as NonNullable<MarkdownExtensionOptions['marked']>
    }
    this.parent?.(event)
    const manager = this.editor.markdown
    if (!manager) {
      throw new Error('Markdown manager was not initialized')
    }
    const parse = manager.parse.bind(manager)
    const schema = this.editor.schema
    manager.parse = markdown => normalizeMarkdownDocument(parse(markdown), schema)

    // The parent hook parses initial Markdown before installing this wrapper.
    // Normalize that JSON as well, including an initially empty document.
    const initialContent = this.editor.options.content
    if (this.editor.options.contentType === 'markdown'
      && initialContent && typeof initialContent === 'object' && !Array.isArray(initialContent)) {
      this.editor.options.content = normalizeMarkdownDocument(initialContent, schema)
    }
  },
})
