import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { win32, posix } from 'node:path'
import { test } from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let workspace, appDir, paths, mobile, calls, failure
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('./file-manager.ts', import.meta.url))],
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'platform-check', setup(build) {
    build.onResolve({ filter: /^@\/lib\/check$/ }, args => ({ path: args.path, external: true }))
  } }],
})
const compiledModule = { exports: {} }
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(name => {
  if (name === '@tauri-apps/api/path') return { appDataDir: async () => appDir, join: async (...args) => paths.join(...args) }
  if (name === '@tauri-apps/plugin-fs') return { BaseDirectory: { AppData: 14 } }
  if (name === '@tauri-apps/plugin-store') return { Store: { load: async () => ({ get: async key => key === 'workspacePath' ? workspace : undefined }) } }
  if (name === '@/lib/check') return { isMobileDevice: () => mobile }
  if (name === '@tauri-apps/plugin-opener') return {
    openPath: async path => { calls.push(['open', path]); if (failure) throw failure },
    revealItemInDir: async path => { calls.push(['reveal', path]); if (failure) throw failure },
  }
  return require(name)
}, compiledModule, compiledModule.exports)
const { showWorkspaceItemInFileManager } = compiledModule.exports
const reset = (windows = false) => {
  workspace = ''; appDir = windows ? 'C:\\Users\\Nigel\\AppData\\Roaming\\NoteGen\\' : '/home/nigel/.local/share/NoteGen/'
  paths = windows ? win32 : posix; mobile = false; calls = []; failure = null
}

test('reveals default-workspace folders with a native absolute path on Windows', async () => {
  reset(true)
  await showWorkspaceItemInFileManager('projects/芯片 design')
  assert.deepEqual(calls, [['reveal', 'C:\\Users\\Nigel\\AppData\\Roaming\\NoteGen\\article\\projects\\芯片 design']])
})

test('uses custom and UNC workspaces without falling back to AppData', async () => {
  for (const root of ['D:\\Notes', '\\\\server\\share\\Notes']) {
    reset(true); workspace = root
    await showWorkspaceItemInFileManager('nested/folder')
    assert.deepEqual(calls, [['reveal', win32.join(root, 'nested/folder')]])
  }
})

test('reveals file paths and POSIX folders through the same desktop API', async () => {
  reset(); await showWorkspaceItemInFileManager('folder/note.md')
  assert.deepEqual(calls, [['reveal', '/home/nigel/.local/share/NoteGen/article/folder/note.md']])
  reset(); workspace = '/mnt/shared notes'; await showWorkspaceItemInFileManager('folder')
  assert.deepEqual(calls, [['reveal', '/mnt/shared notes/folder']])
})

test('keeps mobile folder opening and the workspace root supported', async () => {
  reset(); mobile = true; await showWorkspaceItemInFileManager('folder')
  assert.deepEqual(calls, [['open', '/home/nigel/.local/share/NoteGen/article/folder']])
  reset(); mobile = true; workspace = '/storage/notes'; await showWorkspaceItemInFileManager('')
  assert.deepEqual(calls, [['open', '/storage/notes']])
})

test('propagates a native failure without launching a second file-manager window', async () => {
  reset(true); failure = new Error('Cannot reveal folder')
  await assert.rejects(showWorkspaceItemInFileManager('folder'), /Cannot reveal folder/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'reveal')
})
