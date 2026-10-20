// Round-trip fidelity diagnostic for #1195
// Usage: node scripts/round-trip-fixture.mjs
// Simulates what NoteGen's rich-text editor does to a markdown file:
//   markdown string -> MarkdownManager.parse -> ProseMirror JSON -> MarkdownManager.serialize -> markdown
// Any construct that disappears between input and output is what gets
// silently persisted to disk by md-editor-wrapper's auto-save.
// Compares the baseline (upstream extension-code-block handlers) against the
// fixed handlers shipped in code-block-markdown.ts (via StableCodeBlockLowlight).
import { MarkdownManager, Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import {
  parseFencedCodeBlockToken,
  renderFencedCodeBlockNode,
} from '../src/app/core/main/editor/markdown/code-block-markdown.ts'

// baseline: upstream @tiptap/extension-code-block handlers (current behavior)
const baselineManager = new MarkdownManager({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    CodeBlock,
    Markdown,
  ],
  indentation: { style: 'space', size: 2 },
})

// fixed: same wiring as StableCodeBlockLowlight in code-block-extension.ts,
// running the shipped handlers from code-block-markdown.ts
const FixedCodeBlock = CodeBlock.extend({
  parseMarkdown: parseFencedCodeBlockToken,
  renderMarkdown: renderFencedCodeBlockNode,
})
const fixedManager = new MarkdownManager({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    FixedCodeBlock,
    Markdown,
  ],
  indentation: { style: 'space', size: 2 },
})

const fixtures = {
  'simple-fence': [
    '# Title',
    '',
    '```js',
    'const a = 1',
    '```',
  ].join('\n'),
  'nested-fence-4-backticks': [
    'Outer text.',
    '',
    '````md',
    'inline `code` here',
    '',
    '```js',
    'inner block',
    '```',
    '',
    '````',
  ].join('\n'),
  'fence-inside-list': [
    '- item one',
    '- item two',
    '',
    '  ```js',
    '  const x = 1',
    '  ```',
    '',
    '- item three',
  ].join('\n'),
  'tilde-fence': [
    'text',
    '',
    '~~~python',
    'print("hi")',
    '~~~',
  ].join('\n'),
  'empty-code-block': [
    'text',
    '',
    '```',
    '```',
    '',
    'more text',
  ].join('\n'),
  'info-string-with-attrs': [
    'text',
    '',
    '```js title="example.js" {highlight=1}',
    'const a = 1',
    '```',
  ].join('\n'),
  'indented-code-4-spaces': [
    'text',
    '',
    '    indented code line 1',
    '    indented code line 2',
  ].join('\n'),
  'unclosed-fence-at-eof': [
    'text',
    '',
    '```js',
    'never closed',
  ].join('\n'),
  'fence-in-blockquote': [
    '> quote',
    '',
    '> ```js',
    '> const a = 1',
    '> ```',
  ].join('\n'),
  'fence-after-list-no-blank-line': [
    '- item',
    '```js',
    'const a = 1',
    '```',
  ].join('\n'),
  'multiple-blocks-mixed': [
    '# Doc',
    '',
    '```js',
    'const first = 1',
    '```',
    '',
    'paragraph',
    '',
    '```python',
    'second = 2',
    '```',
  ].join('\n'),
  'frontmatter-plus-code': [
    '---',
    'title: test',
    '---',
    '',
    '```js',
    'const a = 1',
    '```',
  ].join('\n'),
}

function countFencedBlocks(md) {
  const lines = md.split('\n')
  const spans = []
  let open = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/)
    if (!open && m) {
      open = { marker: m[1][0], len: m[1].length, info: m[2].trim(), start: i }
      continue
    }
    if (open) {
      const c = lines[i].match(/^\s*(`{3,}|~{3,})\s*$/)
      if (c && c[1][0] === open.marker && c[1].length >= open.len) {
        spans.push({ ...open, end: i })
        open = null
      }
    }
  }
  if (open) spans.push({ ...open, end: lines.length - 1 })
  return spans
}

function runFixture(manager, source) {
  const parsed = manager.parse(source)
  const output = manager.serialize(parsed)
  const srcSpans = countFencedBlocks(source)
  const outSpans = countFencedBlocks(output)

  // compare the multiset of code block bodies: a block is "lost" when its
  // content no longer appears in any output block. Formatting-only changes
  // (fence marker style, auto-closing an unclosed fence) do not count as loss.
  const bodies = (md, spans) =>
    spans
      .map((s) => md.split('\n').slice(s.start + 1, s.end).join('\n').trim())
      .filter((body) => body.length > 0)
      .sort()

  const srcBodies = bodies(source, srcSpans)
  const outBodies = bodies(output, outSpans)
  const missing = srcBodies.filter((body, index) => outBodies[index] !== body)

  // idempotency: a second round-trip must be stable, otherwise the first
  // output corrupts the document for every later save
  const output2 = manager.serialize(manager.parse(output))

  return { output, missing, identical: output === source, idempotent: output === output2 }
}

let baselineLost = 0
let fixedLost = 0
let fixedNonIdempotent = 0
let fixedChangedNormalFiles = 0

console.log('fixture                         | baseline (upstream)          | fixed (this PR)')
console.log('-------------------------------------------------------------------------')
for (const [name, source] of Object.entries(fixtures)) {
  let base
  let fixed
  try {
    base = runFixture(baselineManager, source)
    fixed = runFixture(fixedManager, source)
  } catch (e) {
    console.log(`✗ ${name}  -> EXCEPTION: ${e.message}`)
    baselineLost++
    continue
  }

  const baseStatus = base.missing.length > 0 ? '✗ LOST' : base.identical ? '✓' : '~ reformatted'
  const fixedStatus = fixed.missing.length > 0 ? '✗ LOST' : fixed.identical ? '✓' : '~ reformatted'
  if (base.missing.length > 0) baselineLost++
  if (fixed.missing.length > 0) fixedLost++
  if (!fixed.idempotent) fixedNonIdempotent++
  // regression guard: files the upstream handled identically must stay byte-identical
  if (base.identical && !fixed.identical) fixedChangedNormalFiles++

  console.log(
    `${name.padEnd(31)} | ${baseStatus.padEnd(28)} | ${fixedStatus}${fixed.idempotent ? '' : '  ⚠ NOT IDEMPOTENT'}`
  )

  if (base.missing.length > 0) {
    console.log(`    baseline lost: ${base.missing.map((m) => m.slice(0, 50)).join(' | ').slice(0, 100)}`)
  }
}

console.log('-------------------------------------------------------------------------')
console.log(`baseline: ${baselineLost}/${Object.keys(fixtures).length} fixtures lost fenced code blocks`)
console.log(`fixed:    ${fixedLost}/${Object.keys(fixtures).length} lost, ${fixedNonIdempotent} non-idempotent, ${fixedChangedNormalFiles} previously-identical files changed`)
if (fixedLost === 0 && fixedNonIdempotent === 0 && fixedChangedNormalFiles === 0) {
  console.log('RESULT: fixed handlers are lossless, idempotent, and byte-compatible with upstream on normal files.')
}
