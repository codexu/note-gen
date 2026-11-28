import { parseIndentedBlocks, type MarkdownToken } from '@tiptap/core'
import { TaskList } from '@tiptap/extension-list'
import { EMPTY_PARAGRAPH_MARKDOWN } from './markdown-paragraph'

export function preserveEscapedTaskMarker(tokens: MarkdownToken[]): MarkdownToken[] {
  const [escaped, rest] = tokens
  if (escaped?.type !== 'escape' || escaped.text !== '[' || rest?.type !== 'text'
    || !/^[ xX]\](?=[ \t\n]|$)/.test(rest.raw ?? '')) return tokens

  // Tiptap's inline parser skips escape tokens. Keep the literal marker text.
  return [{ ...rest, raw: `${escaped.raw}${rest.raw}`, text: `[${rest.text}` }, ...tokens.slice(2)]
}

export const MarkdownTaskList = TaskList.extend({
  parseMarkdown: (token, helpers) => {
    const items = (token.items ?? []).map(item => (
      // Older NoteGen versions used the empty paragraph placeholder here.
      item.text === EMPTY_PARAGRAPH_MARKDOWN ? { ...item, text: '', tokens: [] } : item
    ))
    return helpers.createNode('taskList', {}, helpers.parseChildren(items))
  },

  markdownTokenizer: {
    name: 'taskList',
    level: 'block',
    start: source => source.match(/^\s*[-+*][ \t]+\[[ xX]\][ \t]+/)?.index ?? -1,
    tokenize: (source, _tokens, lexer) => {
      // Let the lexer consume the whole nested body, including sibling blocks
      // after a child task list.
      const result = parseIndentedBlocks(source, {
        itemPattern: /^([ \t]*)[-+*][ \t]+\[([ xX])\][ \t]+(.*)$/,
        extractItemData: ([, indentation, checked, mainContent]) => ({
          indentLevel: indentation.length,
          checked: checked.toLowerCase() === 'x',
          mainContent,
        }),
        createToken: ({ indentLevel, checked, mainContent }, nestedTokens) => ({
          type: 'taskItem',
          raw: '',
          indentLevel,
          checked,
          mainContent,
          text: mainContent,
          tokens: lexer.inlineTokens(mainContent),
          nestedTokens,
        }),
      }, lexer)

      if (!result) return undefined
      return { type: 'taskList', raw: result.raw, items: result.items }
    },
  },
})
