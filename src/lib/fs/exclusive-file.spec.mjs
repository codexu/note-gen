import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  assertDistinctCopyPaths,
  copyFileExclusive,
  writeTextFileExclusive,
} from './exclusive-file.ts'

function createNodeFileSystem(maxWriteBytes = Number.POSITIVE_INFINITY) {
  return {
    async open(path, options) {
      const handle = await open(path, options.read ? 'r' : 'wx')
      return {
        async read(buffer) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
          return bytesRead === 0 ? null : bytesRead
        },
        async write(data) {
          const length = Math.min(data.length, maxWriteBytes)
          const { bytesWritten } = await handle.write(data, 0, length, null)
          return bytesWritten
        },
        async close() {
          await handle.close()
        },
      }
    },
    async remove(path) {
      await rm(path)
    },
  }
}

test('copies to a new file and handles partial writes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'notegen-exclusive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source.md')
  const target = join(root, 'target.md')
  const content = 'A'.repeat(8192)
  await writeFile(source, content)

  await copyFileExclusive(source, target, createNodeFileSystem(7))

  assert.equal(await readFile(target, 'utf8'), content)
})

test('never overwrites or removes an existing target', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'notegen-exclusive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source.md')
  const target = join(root, 'target.md')
  await writeFile(source, 'new')
  await writeFile(target, 'original')

  await assert.rejects(
    copyFileExclusive(source, target, createNodeFileSystem()),
  )
  assert.equal(await readFile(target, 'utf8'), 'original')
})

test('writes text exclusively without truncating existing files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'notegen-exclusive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'note.md')

  await writeTextFileExclusive(target, 'first', createNodeFileSystem(2))
  await assert.rejects(
    writeTextFileExclusive(target, 'second', createNodeFileSystem()),
  )
  assert.equal(await readFile(target, 'utf8'), 'first')
})

test('rejects copying a file onto itself before opening either path', () => {
  assert.throws(
    () => assertDistinctCopyPaths('/workspace/note.md', '/workspace/note.md'),
    /Refusing to copy a file onto itself/,
  )
})
