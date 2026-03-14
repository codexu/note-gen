import test from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeDroppedFileName, writeDroppedFileToRoot } from './root-drop.js'

test('sanitizes dropped filenames by replacing whitespace with underscores', () => {
  assert.equal(sanitizeDroppedFileName('my note.md'), 'my_note.md')
})

test('writes dropped text files using workspace path options', async () => {
  const calls = []

  await writeDroppedFileToRoot({
    fileName: 'my note.md',
    getFilePathOptions: async (relativePath) => {
      calls.push(['getFilePathOptions', relativePath])
      return { path: '/tmp/workspace/my_note.md' }
    },
    writeTextFile: async (path, content, options) => {
      calls.push(['writeTextFile', path, content, options])
    },
  }, {
    kind: 'text',
    content: '# hello',
  })

  assert.deepEqual(calls, [
    ['getFilePathOptions', 'my_note.md'],
    ['writeTextFile', '/tmp/workspace/my_note.md', '# hello', undefined],
  ])
})

test('writes dropped binary files using default workspace baseDir options', async () => {
  const bytes = new Uint8Array([1, 2, 3])
  const calls = []

  await writeDroppedFileToRoot({
    fileName: 'cover image.png',
    getFilePathOptions: async (relativePath) => {
      calls.push(['getFilePathOptions', relativePath])
      return { path: 'article/cover_image.png', baseDir: 'AppData' }
    },
    writeFile: async (path, content, options) => {
      calls.push(['writeFile', path, Array.from(content), options])
    },
  }, {
    kind: 'binary',
    content: bytes,
  })

  assert.deepEqual(calls, [
    ['getFilePathOptions', 'cover_image.png'],
    ['writeFile', 'article/cover_image.png', [1, 2, 3], { baseDir: 'AppData' }],
  ])
})
