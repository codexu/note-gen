import assert from 'node:assert/strict'
import { test } from 'node:test'
import { customizeHtmlExport } from './html-export-customization.js'

const html = '<!DOCTYPE html>\n<html><head><title>Notes</title></head><body><p>Hello</p></body></html>'
const decode = url => Buffer.from(url.split(',')[1], 'base64').toString('utf8')

test('leaves the default export unchanged', () => {
  assert.equal(customizeHtmlExport(html, { css: '', javascript: '' }), html)
  assert.equal(customizeHtmlExport(html, { css: ' \n', javascript: '\t' }), html)
})

test('embeds CSS and JavaScript after the default styles and note content', () => {
  const css = 'p { color: red; }'
  const javascript = 'document.querySelector("p").textContent = "Changed"'
  const result = customizeHtmlExport(html, { css, javascript })
  const link = result.match(/<link rel="stylesheet" href="([^"]+)">/)
  const script = result.match(/<script src="([^"]+)"><\/script>/)
  assert.equal(decode(link[1]), css)
  assert.equal(decode(script[1]), javascript)
  assert.ok(result.indexOf(link[0]) < result.indexOf('</head>'))
  assert.ok(result.indexOf(script[0]) > result.indexOf('<p>Hello</p>'))
})

test('preserves Unicode, literal closing tags and large scripts', () => {
  const css = 'p::after { content: "中文 </style>"; }'
  const javascript = 'window.label = "笔记 </script>";\n' + '// keep this line\n'.repeat(10000)
  const result = customizeHtmlExport(html, { css, javascript })
  const sources = [...result.matchAll(/(?:href|src)="(data:[^"]+)"/g)].map(match => decode(match[1]))
  assert.deepEqual(sources, [css, javascript])
  assert.equal((result.match(/<\/script>/g) || []).length, 1)
  assert.equal((result.match(/<\/body>/g) || []).length, 1)
})
