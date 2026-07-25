import assert from 'node:assert/strict'
import test from 'node:test'
import MarkdownIt from 'markdown-it'

import { buildBlockIndex, resolveBlockRefLink } from '../src/lib/import/siyuan/block-index.ts'
import { convertSyDocumentToMarkdown } from '../src/lib/import/siyuan/converter.ts'
import {
  scanDocumentIssues,
  scanMarkdownIssues,
} from '../src/lib/import/siyuan/scan-import-issues.ts'
import {
  ImportPathAllocator,
  encodeMarkdownLinkDestination,
  isSiYuanAssetReferenceCandidate,
  isSafeSiYuanBlockId,
  parseSiYuanAssetReference,
  sanitizeFileName,
  getImportedAssetRelativePath,
  getNoteGenAssetOutputDir,
} from '../src/lib/import/siyuan/utils.ts'
import { isValidAttributeView } from '../src/lib/import/siyuan/av-loader.ts'
import { validateSiYuanDocument } from '../src/lib/import/siyuan/validation.ts'

const markdown = new MarkdownIt()

function createDocument(children) {
  return {
    Type: 'NodeDocument',
    ID: '20260725000000-abcdefg',
    Properties: {
      id: '20260725000000-abcdefg',
      title: 'Imported note',
    },
    Children: children,
  }
}

function convert(
  document,
  currentMdPath = 'Notebook/Imported note.md',
  attributeViews = new Map(),
  blockIndex = new Map(),
  assetOutputDir = getNoteGenAssetOutputDir(currentMdPath),
) {
  return convertSyDocumentToMarkdown(document, {
    blockIndex,
    attributeViews,
    currentMdPath,
    assetOutputDir,
  })
}

test('sanitizes Windows device filenames and reserves existing paths', () => {
  assert.equal(sanitizeFileName('CON', 'fallback'), '_CON')

  const allocator = new ImportPathAllocator('/workspace')
  allocator.reserveRelativePath('Notebook')
  assert.equal(allocator.allocateRelativeDir('', 'notebook'), 'notebook-1')
  assert.equal(
    allocator.toAbsolutePath('notebook-1/Note.md'),
    '/workspace/notebook-1/Note.md',
  )
})

test('accepts canonical asset paths and rejects traversal', () => {
  assert.deepEqual(parseSiYuanAssetReference('assets/image.png?page=2#preview'), {
    sourcePath: 'assets/image.png',
    suffix: '?page=2#preview',
  })
  assert.equal(parseSiYuanAssetReference('assets/../../store.json'), null)
  assert.equal(parseSiYuanAssetReference('assets/%2e%2e/%2e%2e/store.json'), null)
  assert.equal(parseSiYuanAssetReference('/assets/image.png'), null)
  assert.equal(parseSiYuanAssetReference('assets\\..\\store.json'), null)
})

test('rejects malformed document and block identifiers before traversal', () => {
  assert.throws(
    () => validateSiYuanDocument({
      Type: 'NodeDocument',
      ID: '..',
      Properties: {},
      Children: [],
    }),
    /Invalid SiYuan document/,
  )
  assert.throws(
    () => validateSiYuanDocument({
      Type: 'NodeDocument',
      ID: '20260725000000-abcdefg',
      Properties: {},
      Children: [{ Type: 'NodeParagraph', ID: '..' }],
    }),
    /Invalid SiYuan block ID/,
  )
})

test('rewrites imported asset links relative to each Markdown file', () => {
  const document = createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeImage',
          Children: [
            { Type: 'NodeLinkText', Data: 'Preview' },
            { Type: 'NodeLinkDest', Data: 'assets/image one.png?page=2' },
          ],
        },
      ],
    },
  ])

  const result = convert(document, 'Notebook/Nested/Imported note.md')
  assert.deepEqual(result.assetPaths, ['assets/image one.png'])
  assert.deepEqual(result.invalidAssetPaths, [])
  assert.match(
    result.markdown,
    /!\[Preview\]\(assets\/image%20one\.png\)/,
  )

  const rendered = markdown.render(result.markdown)
  assert.match(
    rendered,
    /src="assets\/image%20one\.png"/,
  )
})

test('strips SiYuan zero-width spaces around image-only paragraphs', () => {
  const document = createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        { Type: 'NodeText', Data: '\u200b' },
        {
          Type: 'NodeImage',
          Children: [
            { Type: 'NodeLinkText', Data: 'image' },
            { Type: 'NodeLinkDest', Data: 'assets/image-20240927215634-zc47599.png' },
          ],
        },
        { Type: 'NodeText', Data: '\u200b' },
      ],
    },
  ])

  const result = convert(document, 'Security/PKI/SCEP.md')
  assert.match(
    result.markdown,
    /^!\[image\]\(assets\/image-20240927215634-zc47599\.png\)$/m,
  )
  assert.doesNotMatch(result.markdown, /\u200b/)

  const rendered = markdown.render(result.markdown)
  assert.match(
    rendered,
    /src="assets\/image-20240927215634-zc47599\.png"/,
  )
})

test('rejects traversal assets and reports them as degraded', () => {
  const document = createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeImage',
          Children: [
            { Type: 'NodeLinkText', Data: 'Unsafe image' },
            { Type: 'NodeLinkDest', Data: 'assets/../../store.json' },
          ],
        },
      ],
    },
  ])

  const result = convert(document)
  assert.deepEqual(result.assetPaths, [])
  assert.deepEqual(result.invalidAssetPaths, ['assets/../../store.json'])
  assert.doesNotMatch(result.markdown, /\.\.\//)
  assert.deepEqual(scanMarkdownIssues(result.markdown, [], result.invalidAssetPaths), [
    { level: 'degraded', code: 'unsafe_asset_path', count: 1 },
  ])
})

test('drops encoded traversal and absolute local hyperlinks', () => {
  const document = createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeTextMark',
          TextMarkType: 'a',
          TextMarkTextContent: 'Encoded traversal',
          TextMarkAHref: '%2e%2e/%2e%2e/store.json',
        },
        { Type: 'NodeText', Data: ' ' },
        {
          Type: 'NodeTextMark',
          TextMarkType: 'a',
          TextMarkTextContent: 'Absolute path',
          TextMarkAHref: '/Users/example/private.txt',
        },
      ],
    },
  ])

  const result = convert(document)
  assert.doesNotMatch(result.markdown, /store\.json|private\.txt/)
  assert.match(result.markdown, /Encoded traversal Absolute path/)
})

test('encodes spaces and punctuation in block-reference destinations', () => {
  const blockIndex = new Map([
    [
      '20260725000001-hijklmn',
      {
        mdPath: 'SiYuan User Guide/Other (Note).md',
        preview: 'Other [Note]',
        anchor: '20260725000001-hijklmn',
      },
    ],
  ])

  const link = resolveBlockRefLink(
    '20260725000001-hijklmn',
    'Other [Note]',
    'SiYuan User Guide/Current Note.md',
    blockIndex,
  )

  assert.equal(
    link,
    '[Other \\[Note\\]](Other%20%28Note%29.md#20260725000001-hijklmn)',
  )
  assert.match(markdown.render(link), /href="Other%20%28Note%29\.md#20260725000001-hijklmn"/)
})

test('preserves raw HTML as escaped code instead of executable markup', () => {
  const document = createDocument([
    {
      Type: 'NodeHTMLBlock',
      Data: '<script>globalThis.compromised = true</script>',
    },
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeText',
          Data: '<img src=x onerror="globalThis.compromised = true">',
        },
      ],
    },
  ])

  const result = convert(document)
  const rendered = markdown.render(result.markdown)
  assert.doesNotMatch(rendered, /<script>/)
  assert.doesNotMatch(rendered, /<img /)
  assert.match(rendered, /&lt;script&gt;/)
  assert.match(rendered, /&lt;img src=x onerror=/)
})

test('collects attribute-view attachments for copying and missing-asset reports', () => {
  const attributeView = {
    id: 'av-1',
    viewID: 'view-1',
    keyValues: [
      {
        key: { id: 'asset-key', name: 'Attachment', type: 'mAsset' },
        values: [
          {
            blockID: 'row-1',
            mAsset: [{ name: 'Report', content: 'assets/report file.pdf' }],
          },
        ],
      },
    ],
    views: [
      {
        id: 'view-1',
        type: 'table',
        table: {
          columns: [{ id: 'asset-key' }],
          rowIds: ['row-1'],
        },
      },
    ],
  }
  const document = createDocument([
    { Type: 'NodeAttributeView', AttributeViewID: 'av-1' },
  ])

  const result = convert(
    document,
    'Notebook/Database.md',
    new Map([['av-1', attributeView]]),
  )

  assert.deepEqual(result.assetPaths, ['assets/report file.pdf'])
  assert.match(
    result.markdown,
    /\[Report\]\(assets\/report%20file\.pdf\)/,
  )
  assert.deepEqual(scanMarkdownIssues(result.markdown, result.assetPaths), [
    { level: 'degraded', code: 'missing_asset', count: 1 },
  ])
})

test('does not emit frontmatter that the editor would display as body text', () => {
  const result = convert(createDocument([
    {
      Type: 'NodeParagraph',
      Children: [{ Type: 'NodeText', Data: 'Body' }],
    },
  ]))

  assert.equal(result.markdown, 'Body\n')
  assert.doesNotMatch(result.markdown, /^---/)
  assert.doesNotMatch(result.markdown, /title:/)
})

test('preserves combined inline marks and explicit hard breaks', () => {
  const result = convert(createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeTextMark',
          TextMarkType: 'a strong em',
          TextMarkTextContent: 'Combined',
          TextMarkAHref: 'https://example.com',
        },
        { Type: 'NodeHardBreak' },
        { Type: 'NodeText', Data: 'Next line' },
      ],
    },
  ]))

  assert.match(result.markdown, /\*\*\*\[Combined\]\(https:\/\/example\.com\)\*\*\*/)
  assert.match(result.markdown, /\\\nNext line/)
  const rendered = markdown.render(result.markdown)
  assert.match(rendered, /<em><strong><a href="https:\/\/example\.com">Combined<\/a><\/strong><\/em>/)
  assert.match(rendered, /<br>\s*Next line/)
})

test('keeps additional blocks and child lists inside their parent list item', () => {
  const result = convert(createDocument([
    {
      Type: 'NodeList',
      ListData: { Typ: 0 },
      Children: [
        {
          Type: 'NodeListItem',
          Children: [
            {
              Type: 'NodeParagraph',
              Children: [{ Type: 'NodeText', Data: 'Parent' }],
            },
            {
              Type: 'NodeParagraph',
              Children: [{ Type: 'NodeText', Data: 'Second paragraph' }],
            },
            {
              Type: 'NodeList',
              ListData: { Typ: 0 },
              Children: [
                {
                  Type: 'NodeListItem',
                  Children: [
                    {
                      Type: 'NodeParagraph',
                      Children: [{ Type: 'NodeText', Data: 'Child' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ]))

  assert.match(result.markdown, /^- Parent\n    \n    Second paragraph\n    - Child$/m)
  const rendered = markdown.render(result.markdown)
  assert.match(rendered, /<li>[\s\S]*Second paragraph[\s\S]*<ul>[\s\S]*<li>Child<\/li>/)
})

test('keeps a leading code block when a list item paragraph follows it', () => {
  const result = convert(createDocument([
    {
      Type: 'NodeList',
      ListData: { Typ: 0 },
      Children: [
        {
          Type: 'NodeListItem',
          Children: [
            {
              Type: 'NodeCodeBlock',
              Children: [
                { Type: 'NodeCodeBlockCode', Data: 'const kept = true' },
              ],
            },
            {
              Type: 'NodeParagraph',
              Children: [{ Type: 'NodeText', Data: 'After code' }],
            },
          ],
        },
      ],
    },
  ]))

  assert.match(result.markdown, /const kept = true/)
  assert.match(result.markdown, /After code/)
  assert.ok(result.markdown.indexOf('const kept = true') < result.markdown.indexOf('After code'))
  const rendered = markdown.render(result.markdown)
  assert.match(rendered, /<li>[\s\S]*<pre><code>const kept = true[\s\S]*After code[\s\S]*<\/li>/)
})

test('uses block IDs as anchors for duplicate headings', () => {
  const document = createDocument([
    {
      Type: 'NodeHeading',
      ID: '20260725000001-hijklmn',
      HeadingLevel: 2,
      Children: [{ Type: 'NodeText', Data: 'Repeated' }],
    },
    {
      Type: 'NodeHeading',
      ID: '20260725000002-opqrstu',
      HeadingLevel: 2,
      Children: [{ Type: 'NodeText', Data: 'Repeated' }],
    },
  ])
  const blockIndex = buildBlockIndex([
    { document, mdRelativePath: 'Notebook/Repeated.md' },
  ])

  assert.equal(blockIndex.get('20260725000001-hijklmn')?.anchor, '20260725000001-hijklmn')
  assert.equal(blockIndex.get('20260725000002-opqrstu')?.anchor, '20260725000002-opqrstu')
})

test('counts nested import issues exactly once', () => {
  const document = createDocument([
    {
      Type: 'NodeList',
      ID: '20260725000001-hijklmn',
      Children: [
        {
          Type: 'NodeListItem',
          ID: '20260725000002-opqrstu',
          Children: [
            {
              Type: 'NodeParagraph',
              ID: '20260725000003-vwxyzab',
              Children: [
                {
                  Type: 'NodeTextMark',
                  TextMarkType: 'inline-memo',
                  TextMarkTextContent: 'Memo text',
                  TextMarkInlineMemoContent: 'Memo',
                },
              ],
            },
          ],
        },
      ],
    },
  ])

  assert.deepEqual(
    scanDocumentIssues(document, {
      blockIndex: new Map(),
      attributeViews: new Map(),
    }),
    [{ level: 'degraded', code: 'inline_memo', count: 1 }],
  )
})

test('reads checklist state from marker child nodes', () => {
  const result = convert(createDocument([
    {
      Type: 'NodeList',
      ListData: { Typ: 3 },
      Children: [
        {
          Type: 'NodeListItem',
          Children: [
            { Type: 'NodeTaskListItemMarker', TaskListItemChecked: true },
            {
              Type: 'NodeParagraph',
              Children: [{ Type: 'NodeText', Data: 'done' }],
            },
          ],
        },
      ],
    },
  ]))

  assert.match(result.markdown, /^- \[x\] done$/m)
})

test('reads checklist state from parent list item fields', () => {
  const result = convert(createDocument([
    {
      Type: 'NodeList',
      ListData: { Typ: 3 },
      Children: [
        {
          Type: 'NodeListItem',
          TaskListItemChecked: true,
          Children: [
            {
              Type: 'NodeParagraph',
              Children: [{ Type: 'NodeText', Data: 'done' }],
            },
          ],
        },
      ],
    },
  ]))

  assert.match(result.markdown, /^- \[x\] done$/m)
})

test('reports malformed asset URIs as unsafe_asset_path', () => {
  assert.equal(isSiYuanAssetReferenceCandidate('assets/%ZZ.png'), true)

  const document = createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeImage',
          Children: [
            { Type: 'NodeLinkText', Data: 'Broken image' },
            { Type: 'NodeLinkDest', Data: 'assets/%ZZ.png' },
          ],
        },
      ],
    },
  ])

  const result = convert(document)
  assert.deepEqual(result.assetPaths, [])
  assert.deepEqual(result.invalidAssetPaths, ['assets/%ZZ.png'])
  assert.match(result.markdown, /^Broken image$/m)
  assert.doesNotMatch(result.markdown, /!\[/)
  assert.deepEqual(scanMarkdownIssues(result.markdown, [], result.invalidAssetPaths), [
    { level: 'degraded', code: 'unsafe_asset_path', count: 1 },
  ])
})

test('preserves widget blocks as degraded fenced content', () => {
  const document = createDocument([
    {
      Type: 'NodeWidget',
      Data: '{"name":"calendar"}',
    },
  ])

  const result = convert(document)
  assert.match(result.markdown, /> SiYuan widget \(imported with reduced fidelity\):/)
  assert.match(result.markdown, /```json/)
  assert.match(result.markdown, /"name":"calendar"/)

  const issues = scanDocumentIssues(document, {
    blockIndex: new Map(),
    attributeViews: new Map(),
  })
  assert.deepEqual(issues, [{ level: 'degraded', code: 'widget', count: 1 }])
})

test('preserves custom blocks and git conflicts as degraded content', () => {
  const customDocument = createDocument([
    { Type: 'NodeCustomBlock', Data: '<div>Custom HTML</div>' },
  ])
  const customResult = convert(customDocument)
  assert.match(customResult.markdown, /> SiYuan custom block \(imported with reduced fidelity\):/)
  assert.match(customResult.markdown, /Custom HTML/)

  const conflictDocument = createDocument([
    { Type: 'NodeGitConflict', Data: '<<<<<<< ours\ncontent\n=======\ntheirs\n>>>>>>>' },
  ])
  const conflictResult = convert(conflictDocument)
  assert.match(conflictResult.markdown, /> SiYuan merge conflict \(imported with reduced fidelity\):/)
  assert.match(conflictResult.markdown, /<<<<<<< ours/)

  assert.deepEqual(
    scanDocumentIssues(customDocument, { blockIndex: new Map(), attributeViews: new Map() }),
    [{ level: 'degraded', code: 'custom_block', count: 1 }],
  )
  assert.deepEqual(
    scanDocumentIssues(conflictDocument, { blockIndex: new Map(), attributeViews: new Map() }),
    [{ level: 'degraded', code: 'git_conflict', count: 1 }],
  )
})

test('reports missing attribute views as degraded placeholders', () => {
  const document = createDocument([
    { Type: 'NodeAttributeView', AttributeViewID: 'av-missing', AttributeViewType: 'table' },
  ])

  const result = convert(document)
  assert.match(result.markdown, /definition not in export/)
  assert.match(result.markdown, /av\\-missing/)

  const issues = scanDocumentIssues(document, {
    blockIndex: new Map(),
    attributeViews: new Map(),
  })
  assert.deepEqual(issues, [{ level: 'degraded', code: 'missing_attribute_view', count: 1 }])
})

test('maps SiYuan asset paths into NoteGen per-note assets directories', () => {
  assert.equal(
    getNoteGenAssetOutputDir('Security/PI and foundamental/Cryptography.md'),
    'Security/PI and foundamental/assets',
  )
  assert.equal(
    getImportedAssetRelativePath('assets/image.png', 'Security/PKI/assets'),
    'Security/PKI/assets/image.png',
  )
  assert.equal(
    getImportedAssetRelativePath('assets/emojis/icon.png', 'Security/PKI/assets'),
    'Security/PKI/assets/emojis/icon.png',
  )
  assert.equal(
    getImportedAssetRelativePath('emojis/icon.png', 'Security/PKI/assets'),
    'Security/PKI/assets/emojis/icon.png',
  )
})

test('places parent documents with subdocuments inside their folder', () => {
  const allocator = new ImportPathAllocator('/workspace')
  const childRelativePath = allocator.allocateRelativeDir('Security', 'VPN')
  const mdRelativePath = allocator.allocateRelativeFile(childRelativePath, 'VPN.md')
  assert.equal(childRelativePath, 'Security/VPN')
  assert.equal(mdRelativePath, 'Security/VPN/VPN.md')
  assert.equal(
    getNoteGenAssetOutputDir(mdRelativePath),
    'Security/VPN/assets',
  )
})

test('truncates filenames by code points and UTF-8 byte limits', () => {
  const cjkName = '文'.repeat(120)
  const truncated = sanitizeFileName(cjkName, 'fallback')
  assert.ok(truncated.length <= 85)
  assert.ok(new TextEncoder().encode(truncated).length <= 255)
  assert.ok([...truncated].every(codePoint => codePoint !== '\uD800'))
})

test('allocateRelativeFile keeps final basename within UTF-8 limits', () => {
  const allocator = new ImportPathAllocator('/workspace')
  allocator.reserveRelativePath('Notebook/文'.repeat(120) + '.md')

  const allocated = allocator.allocateRelativeFile('', '文'.repeat(120))
  const basename = allocated.split('/').pop()
  assert.ok(basename.endsWith('.md'))
  assert.ok(new TextEncoder().encode(basename).length <= 255)
})

test('drops links with unpaired Unicode surrogates instead of throwing', () => {
  const malformedHref = `https://example.com/${'\uD800'}`
  assert.equal(encodeMarkdownLinkDestination(malformedHref), null)

  const document = createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeTextMark',
          TextMarkType: 'a',
          TextMarkTextContent: 'Broken link',
          TextMarkAHref: malformedHref,
        },
      ],
    },
  ])

  const result = convert(document)
  assert.match(result.markdown, /^Broken link$/m)
  assert.doesNotMatch(result.markdown, /https:\/\//)
})

test('skips malformed attribute views without aborting import', () => {
  assert.equal(isValidAttributeView(null), false)
  assert.equal(isValidAttributeView({}), false)
  assert.equal(isValidAttributeView({ id: 'av-1' }), true)
  assert.equal(isValidAttributeView({ id: 'av-1', keyValues: [null] }), false)
  assert.equal(isValidAttributeView({
    id: 'av-1',
    keyValues: [{
      key: { id: 'k1', name: 'Name', type: 'text' },
      values: [null],
    }],
  }), false)
  assert.equal(isValidAttributeView({
    id: 'av-1',
    keyValues: [{
      key: { id: 'k1', name: 'Asset', type: 'mAsset' },
      values: [{ blockID: 'row-1', mAsset: [null] }],
    }],
  }), false)
  assert.equal(isValidAttributeView({
    id: 'av-1',
    keyValues: [{
      key: { id: 'k1', name: 'Relation', type: 'relation' },
      values: [{
        blockID: 'row-1',
        relation: { blockIDs: null, contents: null },
        rollup: { contents: null },
      }],
    }],
  }), true)
  assert.equal(isValidAttributeView({
    id: 'av-1',
    keyValues: [{
      key: { id: 'k1', name: 'Name', type: 'text' },
      values: [{ blockID: 'row-1', text: { content: 'valid' } }],
    }],
  }), true)
})

test('avoids leading-dot filenames that would be hidden in the file tree', () => {
  assert.equal(sanitizeFileName('.hidden note', 'fallback'), '_hidden note')
})

test('renders locatable block references with block-id anchors', () => {
  const targetDocument = createDocument([
    {
      Type: 'NodeHeading',
      ID: '20260725000001-hijklmn',
      HeadingLevel: 2,
      Children: [{ Type: 'NodeText', Data: 'Target heading' }],
    },
  ])
  const sourceDocument = createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeTextMark',
          TextMarkType: 'block-ref',
          TextMarkBlockRefID: '20260725000001-hijklmn',
          TextMarkTextContent: 'See target',
        },
      ],
    },
  ])
  const blockIndex = buildBlockIndex([
    { document: targetDocument, mdRelativePath: 'Notebook/Target.md' },
    { document: sourceDocument, mdRelativePath: 'Notebook/Source.md' },
  ])

  const result = convertSyDocumentToMarkdown(sourceDocument, {
    blockIndex,
    attributeViews: new Map(),
    currentMdPath: 'Notebook/Source.md',
    assetOutputDir: getNoteGenAssetOutputDir('Notebook/Source.md'),
  })

  assert.match(result.markdown, /\[See target\]\(Target\.md#20260725000001-hijklmn\)/)

  const targetMarkdown = convert(targetDocument, 'Notebook/Target.md').markdown
  assert.match(targetMarkdown, /id="20260725000001-hijklmn"/)
})

test('rejects unsafe block ids instead of emitting raw HTML anchors', () => {
  assert.equal(isSafeSiYuanBlockId('20260725000001-hijklmn'), true)
  assert.equal(isSafeSiYuanBlockId('"><img src=x onerror=alert(1)>'), false)

  const document = createDocument([
    {
      Type: 'NodeParagraph',
      ID: '"><img src=x onerror=alert(1)>',
      Properties: { id: '"><img src=x onerror=alert(1)>' },
      Children: [{ Type: 'NodeText', Data: 'Unsafe anchor' }],
    },
  ])

  const markdownOutput = convert(document, 'Notebook/Unsafe.md').markdown
  assert.doesNotMatch(markdownOutput, /<span id="/)
  assert.match(markdownOutput, /Unsafe anchor/)
})

test('drops local asset query and fragment suffixes from markdown output', () => {
  const parsed = parseSiYuanAssetReference('assets/logo.png?v=1#preview')
  assert.deepEqual(parsed, {
    sourcePath: 'assets/logo.png',
    suffix: '?v=1#preview',
  })

  const document = createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeImage',
          Children: [
            { Type: 'NodeLinkText', Data: 'Logo' },
            { Type: 'NodeLinkDest', Data: 'assets/logo.png?v=1#preview' },
          ],
        },
      ],
    },
  ])

  const result = convert(document, 'Notebook/Assets.md')
  assert.match(
    result.markdown,
    /!\[Logo\]\(assets\/logo\.png\)/,
  )
  assert.doesNotMatch(result.markdown, /logo\.png\?v=1/)
})

test('parses block query embed scripts for block ids', async () => {
  const { parseBlockQueryEmbedBlockId } = await import('../src/lib/import/siyuan/embed-query.ts')
  assert.equal(
    parseBlockQueryEmbedBlockId("select * from blocks where id='20230407103640-aaaxjms'"),
    '20230407103640-aaaxjms',
  )
  assert.equal(parseBlockQueryEmbedBlockId('select * from blocks where content like "%dns%"'), null)
})

test('renders unresolved block query embeds as degraded placeholders', () => {
  const document = createDocument([
    {
      Type: 'NodeHeading',
      HeadingLevel: 2,
      Children: [{ Type: 'NodeText', Data: 'DNS operations' }],
    },
    {
      Type: 'NodeBlockQueryEmbed',
      Children: [
        {
          Type: 'NodeBlockQueryEmbedScript',
          Data: "select * from blocks where id='20230407103640-aaaxjms'",
        },
      ],
    },
  ])

  const result = convert(document)
  assert.match(result.markdown, /> Embedded block query \(content not in export\):/)
  assert.match(result.markdown, /20230407103640-aaaxjms/)

  const issues = scanDocumentIssues(document, {
    blockIndex: new Map(),
    attributeViews: new Map(),
  })
  assert.deepEqual(issues, [{ level: 'degraded', code: 'embed_block', count: 1 }])
})

test('renders resolvable block query embeds as links to indexed blocks', () => {
  const refId = '20230407103640-aaaxjms'
  const document = createDocument([
    {
      Type: 'NodeBlockQueryEmbed',
      Children: [
        {
          Type: 'NodeBlockQueryEmbedScript',
          Data: `select * from blocks where id='${refId}'`,
        },
      ],
    },
  ])
  const blockIndex = new Map([
    [refId, { mdPath: 'Notebook/Target note.md', preview: 'Target preview', anchor: refId }],
  ])

  const result = convert(document, 'Notebook/Source note.md', undefined, blockIndex)
  assert.match(result.markdown, /> Embedded block:/)
  assert.match(result.markdown, /\[Target preview\]\(Target%20note\.md/)
  assert.doesNotMatch(result.markdown, /content not in export/)

  const issues = scanDocumentIssues(document, {
    blockIndex,
    attributeViews: new Map(),
  })
  assert.deepEqual(issues, [])
})

test('reports av row truncation as degraded import issues', () => {
  const rowIds = Array.from({ length: 5001 }, (_, index) => `20260725${String(100000 + index)}-row001`)
  const attributeView = {
    id: 'av-large',
    viewID: 'view-1',
    keyValues: [
      {
        key: { id: 'text-key', name: 'Name', type: 'text' },
        values: rowIds.map(rowId => ({
          blockID: rowId,
          text: { content: rowId },
        })),
      },
    ],
    views: [
      {
        id: 'view-1',
        type: 'table',
        table: {
          columns: [{ id: 'text-key' }],
          rowIds,
        },
      },
    ],
  }
  const document = createDocument([
    { Type: 'NodeAttributeView', AttributeViewID: 'av-large' },
  ])

  const result = convert(
    document,
    'Notebook/Large database.md',
    new Map([['av-large', attributeView]]),
  )

  assert.match(result.markdown, /omitted 1 row\(s\) and 0 column\(s\)/)
  assert.deepEqual(result.importIssues, [
    {
      level: 'degraded',
      code: 'av_truncated',
      count: 1,
      omittedRows: 1,
      omittedColumns: undefined,
      markdownBytesTruncated: undefined,
    },
  ])
})

test('reports unknown node types as degraded instead of silent loss', () => {
  const document = createDocument([
    {
      Type: 'NodeFutureBlock',
      Data: 'future content',
    },
  ])

  const result = convert(document)
  assert.match(result.markdown, /NodeFutureBlock/)
  assert.match(result.markdown, /future content/)

  const issues = scanDocumentIssues(document, {
    blockIndex: new Map(),
    attributeViews: new Map(),
  })
  assert.deepEqual(issues, [{ level: 'degraded', code: 'unknown_node_type', count: 1 }])
})

test('does not flag kramdown inline AST nodes as unknown block types', () => {
  const document = createDocument([
    {
      Type: 'NodeParagraph',
      Children: [
        {
          Type: 'NodeImage',
          Children: [
            { Type: 'NodeBang' },
            { Type: 'NodeOpenBracket' },
            { Type: 'NodeLinkText', Data: 'Example' },
            { Type: 'NodeCloseBracket' },
            { Type: 'NodeOpenParen' },
            { Type: 'NodeLinkDest', Data: 'https://example.com' },
            { Type: 'NodeCloseParen' },
          ],
        },
        { Type: 'NodeBr' },
        { Type: 'NodeText', Data: 'Next line' },
      ],
    },
  ])

  const issues = scanDocumentIssues(document, {
    blockIndex: new Map(),
    attributeViews: new Map(),
  })
  assert.deepEqual(issues, [])
})

test('reports unsupported spec versions as degraded', () => {
  const document = createDocument([
    {
      Type: 'NodeParagraph',
      Spec: '2',
      Children: [{ Type: 'NodeText', Data: 'Future spec paragraph' }],
    },
  ])

  const result = convert(document)
  assert.match(result.markdown, /Future spec paragraph/)

  const issues = scanDocumentIssues(document, {
    blockIndex: new Map(),
    attributeViews: new Map(),
  })
  assert.deepEqual(issues, [{ level: 'degraded', code: 'unsupported_spec', count: 1 }])
})

test('rejects invalid spec strings during validation', () => {
  assert.throws(
    () => validateSiYuanDocument(createDocument([
      {
        Type: 'NodeParagraph',
        Spec: 'beta',
        Children: [{ Type: 'NodeText', Data: 'Bad spec' }],
      },
    ])),
    /Invalid SiYuan spec/,
  )
})
