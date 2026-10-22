import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { build } from 'esbuild'
import { customizeHtmlExport } from './html-export-customization.js'

const editorModule = new URL('../app/core/main/editor/markdown/markdown-export.ts', import.meta.url)
const editorPath = fileURLToPath(editorModule)
const fixture = '<!DOCTYPE html><html><head></head><body><p>Note</p></body></html>'
let captured
let config = { css: 'p { color: red }', javascript: 'window.custom = true' }
// Keep the real format routing and replace rendering, saving and native printing boundaries.
const source = await readFile(editorModule, 'utf8') + `
  buildMarkdownExportDocument = async () => ${JSON.stringify(fixture)};
  saveTextExport = async content => capture(content);
  openTauriPrintWindow = async content => capture(content);
  notifyPdfRenderStart = async () => {};
`
const bundled = await build({
  stdin: { contents: source, sourcefile: editorPath, resolveDir: dirname(editorPath), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'export-boundaries', setup(build) {
    build.onResolve({ filter: /.*/ }, args => args.path === '@tauri-apps/plugin-os'
      ? { path: args.path, namespace: 'platform' } : { path: args.path, external: true })
    build.onLoad({ filter: /.*/, namespace: 'platform' }, () => ({ contents: 'export const platform = () => "macos"' }))
  } }],
})
const compiledModule = { exports: {} }
new Function('require', 'module', 'exports', 'capture', bundled.outputFiles[0].text)(name => {
  if (name === '@/lib/html-export-customization') return { customizeHtmlExport }
  if (name === '@/stores/setting') return { __esModule: true, default: { getState: () => ({ htmlExportConfig: config }) } }
  if (name === '@/lib/check') return { checkIsTauri: () => true }
  if (name === '@tauri-apps/plugin-dialog') return { save: async () => 'note.pdf' }
  return {}
}, compiledModule, compiledModule.exports, content => { captured = content; return true })
const { exportMarkdownSource } = compiledModule.exports
const note = { baseName: 'note.md', markdown: 'Original note' }

test('HTML export includes the saved customization', async () => {
  await exportMarkdownSource('html', note)
  assert.equal(captured, customizeHtmlExport(fixture, config))
  assert.ok(captured.includes('data:text/css;base64,'))
  assert.ok(captured.includes('data:text/javascript;base64,'))
})

test('native PDF and Markdown exports do not receive HTML customization', async () => {
  await exportMarkdownSource('pdf', note)
  assert.equal(captured, fixture)
  await exportMarkdownSource('markdown', note)
  assert.equal(captured, note.markdown)
})

test('HTML export stays unchanged when customization is cleared', async () => {
  config = { css: '', javascript: '' }
  await exportMarkdownSource('html', note)
  assert.equal(captured, fixture)
})
