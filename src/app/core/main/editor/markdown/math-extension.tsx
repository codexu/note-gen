import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useMemo, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// Inline Math Component
function InlineMathView({ node, updateAttributes }: ReactNodeViewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [latex, setLatex] = useState(node.attrs.latex || '')
  const [error, setError] = useState<string | null>(null)

  const renderedHtml = useMemo(() => {
    try {
      setError(null)
      return katex.renderToString(node.attrs.latex || '', {
        throwOnError: false,
        displayMode: false,
      })
    } catch (e) {
      setError((e as Error).message)
      return `<span class="text-red-500">Invalid LaTeX</span>`
    }
  }, [node.attrs.latex])

  const handleUpdate = () => {
    updateAttributes({ latex })
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
      <NodeViewWrapper className="inline-math-wrapper inline">
        <input
          type="text"
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onBlur={handleUpdate}
          onKeyDown={handleKeyDown}
          className="inline-math-input px-2 py-1 border rounded bg-background text-foreground min-w-25 focus:outline-none focus:ring-2 focus:ring-primary"
          autoFocus
        />
        {error && <span className="text-red-500 text-xs ml-2">{error}</span>}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      className="inline-math-wrapper inline mx-1 px-1 py-0.5 rounded bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
      onClick={() => setIsEditing(true)}
    >
      <span
        className="tiptap-mathematics-render tiptap-mathematics-render--editable"
        data-type="inline-math"
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    </NodeViewWrapper>
  )
}

// Block Math Component
function BlockMathView({ node, updateAttributes }: ReactNodeViewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [latex, setLatex] = useState(node.attrs.latex || '')
  const [error, setError] = useState<string | null>(null)

  const renderedHtml = useMemo(() => {
    try {
      setError(null)
      return katex.renderToString(node.attrs.latex || '', {
        throwOnError: false,
        displayMode: true,
      })
    } catch (e) {
      setError((e as Error).message)
      return `<span class="text-red-500">Invalid LaTeX</span>`
    }
  }, [node.attrs.latex])

  const handleUpdate = () => {
    updateAttributes({ latex })
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
        <textarea
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onBlur={handleUpdate}
          onKeyDown={handleKeyDown}
          className="block-math-input w-full px-3 py-2 border rounded bg-background text-foreground min-h-15 focus:outline-none focus:ring-2 focus:ring-primary font-mono"
          autoFocus
        />
        {error && <span className="text-red-500 text-xs mt-1">{error}</span>}
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper
      className="block-math-wrapper my-4 p-4 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => setIsEditing(true)}
    >
      <div
        className="tiptap-mathematics-render tiptap-mathematics-render--editable overflow-x-auto"
        data-type="block-math"
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
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
      {
        tag: 'inline-math',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['inline-math', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView)
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
      {
        tag: 'block-math',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['block-math', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockMathView)
  },
})
