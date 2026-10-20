'use client'

import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { normalizeLatexForKatex } from '@/lib/latex'
import { Textarea } from '@/components/ui/textarea'
import { useViewportActivation } from './viewport-activation'
import { createViewportWorkQueue } from './viewport-work-scheduler'
import { updateNodeViewOnMarkupChange } from './node-view-update'
import { blockMathTokenizer, inlineMathTokenizer } from './markdown-tokenizers'

type KatexApi = (typeof import('katex'))['default']

const KATEX_CACHE_LIMIT = 200
const BLOCK_MATH_PLACEHOLDER_LIMIT = 240
const katexHtmlCache = new Map<string, string>()
let katexPromise: Promise<KatexApi> | null = null
const scheduleKatexWork = createViewportWorkQueue()

async function getKatex(): Promise<KatexApi> {
  katexPromise ??= import('katex').then(({ default: katex }) => katex)
  return await katexPromise
}

function cacheKatexHtml(key: string, html: string) {
  if (katexHtmlCache.has(key)) {
    katexHtmlCache.delete(key)
  }
  katexHtmlCache.set(key, html)

  const oldestKey = katexHtmlCache.keys().next().value
  if (katexHtmlCache.size > KATEX_CACHE_LIMIT && typeof oldestKey === 'string') {
    katexHtmlCache.delete(oldestKey)
  }
}

function useLazyKatex<ElementType extends HTMLElement>(
  latex: string,
  displayMode: boolean,
  isEditing: boolean
) {
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const renderVersionRef = useRef(0)
  const { elementRef, isActive, activate } = useViewportActivation<ElementType>()

  useEffect(() => {
    if (!isActive || isEditing) return

    const renderVersion = ++renderVersionRef.current
    const cacheKey = `${displayMode ? 'block' : 'inline'}:${latex}`
    const cachedHtml = katexHtmlCache.get(cacheKey)
    if (cachedHtml) {
      setRenderedHtml(cachedHtml)
      setError(null)
      return
    }

    setRenderedHtml(null)
    setError(null)
    const cancelWork = scheduleKatexWork(async () => {
      try {
        const katex = await getKatex()
        if (renderVersionRef.current !== renderVersion) return

        const html = katex.renderToString(normalizeLatexForKatex(latex), {
          throwOnError: false,
          displayMode,
        })
        if (renderVersionRef.current !== renderVersion) return

        cacheKatexHtml(cacheKey, html)
        setRenderedHtml(html)
        setError(null)
      } catch (renderError: unknown) {
        if (renderVersionRef.current !== renderVersion) return

        setRenderedHtml(null)
        setError(renderError instanceof Error ? renderError.message : String(renderError))
      }
    })

    return () => {
      cancelWork()
      renderVersionRef.current++
    }
  }, [displayMode, isActive, isEditing, latex])

  return { activate, elementRef, error, renderedHtml }
}

// Inline Math Component
function InlineMathView({ node, updateAttributes }: ReactNodeViewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [latex, setLatex] = useState(node.attrs.latex || '')
  const { activate, elementRef, error, renderedHtml } = useLazyKatex<HTMLSpanElement>(
    node.attrs.latex || '',
    false,
    isEditing
  )

  useEffect(() => {
    if (!isEditing) setLatex(node.attrs.latex || '')
  }, [isEditing, node.attrs.latex])

  const handleUpdate = () => {
    updateAttributes({ latex })
    activate()
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleUpdate()
    }
    if (e.key === 'Escape') {
      setLatex(node.attrs.latex || '')
      setIsEditing(false)
    }
  }

  if (isEditing) {
    return (
      <NodeViewWrapper as="span" className="inline-math-wrapper inline">
        <input
          type="text"
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onBlur={handleUpdate}
          onKeyDown={handleKeyDown}
          className="inline-math-input px-2 py-1 border rounded bg-background text-foreground min-w-25 focus:outline-none focus:ring-2 focus:ring-primary"
          autoFocus
        />
        {error && <span className="ml-2 text-xs text-destructive">{error}</span>}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      as="span"
      className="inline-math-wrapper inline mx-1 px-1 py-0.5 rounded bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
      onClick={() => {
        activate()
        setIsEditing(true)
      }}
    >
      {renderedHtml ? (
        <span
          ref={elementRef}
          className="tiptap-mathematics-render tiptap-mathematics-render--editable"
          data-type="inline-math"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <span ref={elementRef} className="font-mono text-sm" data-type="inline-math">
          ${node.attrs.latex || ''}$
        </span>
      )}
      {error ? <span className="ml-2 text-xs text-destructive">{error}</span> : null}
    </NodeViewWrapper>
  )
}

// Block Math Component
function BlockMathView({ node, updateAttributes }: ReactNodeViewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [latex, setLatex] = useState(node.attrs.latex || '')
  const { activate, elementRef, error, renderedHtml } = useLazyKatex<HTMLDivElement>(
    node.attrs.latex || '',
    true,
    isEditing
  )
  const blockPlaceholder = String(node.attrs.latex || '')
  const truncatedBlockPlaceholder = blockPlaceholder.length > BLOCK_MATH_PLACEHOLDER_LIMIT
    ? `${blockPlaceholder.slice(0, BLOCK_MATH_PLACEHOLDER_LIMIT)}…`
    : blockPlaceholder

  useEffect(() => {
    if (!isEditing) setLatex(node.attrs.latex || '')
  }, [isEditing, node.attrs.latex])

  const handleUpdate = () => {
    updateAttributes({ latex })
    activate()
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleUpdate()
    }
    if (e.key === 'Escape') {
      setLatex(node.attrs.latex || '')
      setIsEditing(false)
    }
  }

  if (isEditing) {
    return (
      <NodeViewWrapper className="block-math-wrapper my-4">
        <Textarea
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onBlur={handleUpdate}
          onKeyDown={handleKeyDown}
          rows={3}
          maxRows={12}
          className="block-math-input min-h-15 font-mono"
          autoFocus
        />
        {error && <span className="mt-1 text-xs text-destructive">{error}</span>}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      className="block-math-wrapper my-4 p-4 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => {
        activate()
        setIsEditing(true)
      }}
    >
      {renderedHtml ? (
        <div
          ref={elementRef}
          className="tiptap-mathematics-render tiptap-mathematics-render--editable overflow-x-auto"
          data-type="block-math"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <div
          ref={elementRef}
          className="min-h-16 overflow-x-auto whitespace-pre-wrap text-center font-mono text-sm text-muted-foreground"
          data-type="block-math"
        >
          {`$$${truncatedBlockPlaceholder}$$`}
        </div>
      )}
      {error ? <span className="mt-1 text-xs text-destructive">{error}</span> : null}
    </NodeViewWrapper>
  )
}

// Inline Math Extension
export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-type="inline-math"]', getAttrs: (node: HTMLElement | string) => {
        if (typeof node === 'string') return false
        return { latex: node.getAttribute('data-latex') || '' }
      }},
      { tag: 'span[data-latex]', getAttrs: (node: HTMLElement | string) => {
        if (typeof node === 'string') return false
        return { latex: node.getAttribute('data-latex') || '' }
      }},
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView, { update: updateNodeViewOnMarkupChange })
  },

  addInputRules() {
    return [
      nodeInputRule({
        // Convert `$...$` to an inline math node as soon as the closing `$` is typed.
        find: /(?<!\$)\$[^\$\n]+\$$/,
        type: this.type,
        getAttributes: (match) => ({
          latex: match[0].slice(1, -1),
        }),
      }),
      nodeInputRule({
        // Convert `\(...\)` to an inline math node.
        find: /\\\([^\n]+?\\\)$/,
        type: this.type,
        getAttributes: (match) => ({
          latex: match[0].slice(2, -2),
        }),
      }),
    ]
  },

  // Configure Markdown serialization for the Tiptap Markdown extension
  markdownTokenName: 'inline_math',

  // Custom tokenizer for $...$ syntax
  markdownTokenizer: inlineMathTokenizer,

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return `$${node.attrs?.latex ?? ''}$`
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    return {
      type: 'inlineMath',
      attrs: { latex: token.content ?? (token.raw?.slice(1, -1) ?? '') },
    }
  },
})

// Block Math Extension
export const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="block-math"]', getAttrs: (node: HTMLElement | string) => {
        if (typeof node === 'string') return false
        return { latex: node.getAttribute('data-latex') || '' }
      }},
      { tag: 'div[data-latex]', getAttrs: (node: HTMLElement | string) => {
        if (typeof node === 'string') return false
        return { latex: node.getAttribute('data-latex') || '' }
      }},
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockMathView, { update: updateNodeViewOnMarkupChange })
  },

  addInputRules() {
    return [
      nodeInputRule({
        // Convert `$$...$$` within a paragraph to a block math node immediately.
        find: /^\$\$[\s\S]+?\$\$$/,
        type: this.type,
        getAttributes: (match) => ({
          latex: match[0].slice(2, -2).trim(),
        }),
      }),
      nodeInputRule({
        // Convert `\[...\]` within a paragraph to a block math node immediately.
        find: /^\\\[[\s\S]+?\\\]$/,
        type: this.type,
        getAttributes: (match) => ({
          latex: match[0].slice(2, -2).trim(),
        }),
      }),
    ]
  },

  // Configure Markdown serialization for the Tiptap Markdown extension
  markdownTokenName: 'block_math',

  // Custom tokenizer for $$...$$ syntax
  markdownTokenizer: blockMathTokenizer,

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return `\n$$${node.attrs?.latex ?? ''}$$\n`
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    return {
      type: 'blockMath',
      attrs: { latex: token.content ?? (token.raw?.slice(2, -2) ?? '') },
    }
  },
})
