'use client'

import { Node, mergeAttributes, InputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'

interface MathOptions {
  HTMLAttributes: Record<string, string>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathInline: {
      setMathInline: (options: { formula: string }) => ReturnType
    }
    mathBlock: {
      setMathBlock: (options: { formula: string }) => ReturnType
    }
  }
}

// Inline Math Component
function MathInlineComponent({ node, updateAttributes }: any) {
  const [formula, setFormula] = useState(node.attrs.formula)
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  const handleBlur = () => {
    setIsEditing(false)
    updateAttributes({ formula })
  }

  return (
    <span
      className="math-inline px-1 rounded bg-[hsl(var(--muted))] cursor-pointer"
      onClick={() => setIsEditing(true)}
      data-type="math-inline"
    >
      {isEditing ? (
        <input
          ref={inputRef}
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleBlur()
            }
            if (e.key === 'Escape') {
              setFormula(node.attrs.formula)
              setIsEditing(false)
            }
          }}
          className="bg-transparent border-none outline-none min-w-[60px] font-mono text-sm"
        />
      ) : (
        <code className="font-mono text-sm">${formula}$</code>
      )}
    </span>
  )
}

// Block Math Component
function MathBlockComponent({ node, updateAttributes }: any) {
  const [formula, setFormula] = useState(node.attrs.formula)
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  const handleBlur = () => {
    setIsEditing(false)
    updateAttributes({ formula })
  }

  return (
    <div
      className="math-block my-2 p-3 rounded bg-[hsl(var(--muted))] cursor-pointer"
      onClick={() => setIsEditing(true)}
      data-type="math-block"
    >
      {isEditing ? (
        <textarea
          ref={inputRef}
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleBlur()
            }
            if (e.key === 'Escape') {
              setFormula(node.attrs.formula)
              setIsEditing(false)
            }
          }}
          className="w-full bg-transparent border-none outline-none font-mono text-sm resize-none"
          rows={Math.max(2, formula.split('\n').length)}
        />
      ) : (
        <pre className="font-mono text-sm overflow-x-auto">$${formula}$$</pre>
      )}
    </div>
  )
}

export const MathInline = Node.create<MathOptions>({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      formula: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-type="math-inline"]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math-inline', class: 'math-inline' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineComponent)
  },

  addCommands() {
    return {
      setMathInline:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },

  addInputRules(): InputRule[] {
    return [
      {
        find: /\$([^\$]+)\$/g,
        undoable: true,
        handler: ({ state, range, match }) => {
          const start = range.from
          const formula = match[1].trim()

          state.tr.replaceWith(
            start,
            range.to,
            this.type.create({ formula })
          )
        },
      },
    ]
  },
})

export const MathBlock = Node.create<MathOptions>({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      formula: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="math-block"]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math-block', class: 'math-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockComponent)
  },

  addCommands() {
    return {
      setMathBlock:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },

  addInputRules(): InputRule[] {
    return [
      {
        find: /\$\$\n([^\$]+)\n\$\$/g,
        undoable: true,
        handler: ({ state, range, match }) => {
          const formula = match[1].trim()
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ formula })
          )
        },
      },
    ]
  },
})
