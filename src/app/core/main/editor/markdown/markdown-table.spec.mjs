import assert from 'node:assert/strict'
import test from 'node:test'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { TableRow } from '@tiptap/extension-table'
import { MarkdownParagraph, normalizeMarkdownPlaceholders } from './markdown-paragraph.ts'
import { MarkdownTable, MarkdownTableCell, MarkdownTableHeader } from './markdown-table.ts'

const manager = new MarkdownManager({
  extensions: [
    StarterKit.configure({ paragraph: false }),
    MarkdownParagraph,
    MarkdownTable,
    TableRow,
    MarkdownTableHeader,
    MarkdownTableCell,
  ],
})

const text = value => ({ type: 'text', text: value })
const paragraph = (...content) => ({ type: 'paragraph', content })

function serializeTable(content, header = [paragraph(text('Header'))], align = null) {
  return normalizeMarkdownPlaceholders(manager.serialize({
    type: 'doc',
    content: [{
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { align }, content: header }] },
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { align }, content }] },
      ],
    }],
  }))
}

test('saves hard breaks in table headers and body cells as HTML breaks', () => {
  const content = [paragraph(text('First'), { type: 'hardBreak' }, text('Second'))]
  const markdown = serializeTable(content, content)

  assert.equal(markdown.match(/First<br>Second/g)?.length, 2)
  assert.equal(markdown.trim().split('\n').length, 3)
})

test('keeps separate cell paragraphs after save normalization', () => {
  const markdown = serializeTable([paragraph(text('First')), paragraph(text('Second'))])

  assert.match(markdown, /First<br>Second/)
  assert.doesNotMatch(markdown, /\u001f/)
})

test('preserves consecutive hard breaks and an empty cell paragraph', () => {
  const hardBreaks = serializeTable([
    paragraph(text('First'), { type: 'hardBreak' }, { type: 'hardBreak' }, text('Third')),
  ])
  const emptyParagraph = serializeTable([
    paragraph(text('First')), paragraph(), paragraph(text('Third')),
  ])

  assert.match(hardBreaks, /First<br><br>Third/)
  assert.match(emptyParagraph, /First<br><br>Third/)
})

test('retains inline formatting and column alignment around a cell break', () => {
  const markdown = serializeTable([
    paragraph(
      { ...text('First'), marks: [{ type: 'bold' }] },
      { type: 'hardBreak' },
      { ...text('Second'), marks: [{ type: 'italic' }] },
    ),
  ], undefined, 'center')

  assert.match(markdown, /\*\*First\*\*<br>\*Second\*/)
  assert.match(markdown, /\| :---: \|/)
})

test('leaves ordinary table cells and hard breaks outside tables unchanged', () => {
  assert.match(serializeTable([paragraph(text('First Second'))]), /First Second/)
  assert.equal(manager.serialize({
    type: 'doc',
    content: [paragraph(text('First'), { type: 'hardBreak' }, text('Second'))],
  }), 'First  \nSecond')
})
