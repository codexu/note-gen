'use client'

import { Extension } from '@tiptap/core'

/**
 * Markdown input rules for Tiptap
 * Supports: headings, blockquotes, lists, code blocks, horizontal rules, formatting
 */
export const MarkdownInputRules = Extension.create({
  name: 'markdownInputRules',

  addInputRules() {
    return [
      {
        // Heading 1: # → H1
        find: /^#\s$/,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, state.schema.nodes.heading.create({ level: 1 }))
        },
      },
      {
        // Heading 2: ## → H2
        find: /^##\s$/,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, state.schema.nodes.heading.create({ level: 2 }))
        },
      },
      {
        // Heading 3: ### → H3
        find: /^###\s$/,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, state.schema.nodes.heading.create({ level: 3 }))
        },
      },
      {
        // Blockquote: > → Blockquote
        find: /^>\s$/,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, state.schema.nodes.blockquote.create())
        },
      },
      {
        // Bullet list: - or * → Bullet list
        find: /^[-*]\s$/,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, state.schema.nodes.bullet_list.create())
        },
      },
      {
        // Ordered list: 1. → Ordered list
        find: /^1\.\s$/,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, state.schema.nodes.ordered_list.create())
        },
      },
      {
        // Task list unchecked: - [ ] → Task list
        find: /^- \[\]\s$/,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          const taskItem = state.schema.nodes.taskItem.create({ checked: false })
          tr.replaceWith(range.from, range.to, state.schema.nodes.taskList.create({ content: [taskItem] }))
        },
      },
      {
        // Task list checked: - [x] → Task list
        find: /^- \[x\]\s$/i,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          const taskItem = state.schema.nodes.taskItem.create({ checked: true })
          tr.replaceWith(range.from, range.to, state.schema.nodes.taskList.create({ content: [taskItem] }))
        },
      },
      {
        // Code block: ```
        find: /^```$/,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, state.schema.nodes.codeBlock.create())
        },
      },
      {
        // Horizontal rule: --- or ***
        find: /^(?:---|\*\*\*)$/,
        undoable: true,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, state.schema.nodes.horizontalRule.create())
        },
      },
      {
        // Bold: **text** or __text__
        find: /(\*\*|__)([^*]+)\1$/,
        undoable: true,
        handler: ({ state, range, match }) => {
          const { tr } = state
          const start = range.from
          const end = range.to
          const text = match[2]
          tr.replaceWith(start, end, state.schema.text(text, [state.schema.marks.strong.create()]))
        },
      },
      {
        // Strike: ~~text~~
        find: /~~([^~]+)~~$/,
        undoable: true,
        handler: ({ state, range, match }) => {
          const { tr } = state
          const text = match[1]
          tr.replaceWith(range.from, range.to, state.schema.text(text, [state.schema.marks.strike.create()]))
        },
      },
      {
        // Inline code: `text`
        find: /`([^`]+)`$/,
        undoable: true,
        handler: ({ state, range, match }) => {
          const { tr } = state
          const text = match[1]
          tr.replaceWith(range.from, range.to, state.schema.text(text, [state.schema.marks.code.create()]))
        },
      },
    ]
  },
})

export default MarkdownInputRules
