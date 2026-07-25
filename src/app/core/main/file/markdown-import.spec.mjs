import assert from 'node:assert/strict'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { importMarkdownDirectory } from './markdown-import.ts'

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const nodeFileSystem = {
  async readDir(path) {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }))
  },
  exists: pathExists,
  mkdir: path => mkdir(path, { recursive: true }),
  join: async (...paths) => join(...paths),
  copyFileExclusive: (source, target) => copyFile(source, target, constants.COPYFILE_EXCL),
  removeFile: path => rm(path),
  removeDirectory: path => rmdir(path),
}

test('imports supported files and ignores unrelated content', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'notegen-markdown-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const target = join(root, 'target')
  await mkdir(join(source, 'notes'), { recursive: true })
  await mkdir(target)
  await writeFile(join(source, 'notes', 'note.md'), '# Note')
  await writeFile(join(source, 'image.png'), 'image')
  await writeFile(join(source, 'ignored.txt'), 'ignored')

  const count = await importMarkdownDirectory(source, target, nodeFileSystem)

  assert.equal(count, 2)
  assert.equal(await readFile(join(target, 'notes', 'note.md'), 'utf8'), '# Note')
  assert.equal(await readFile(join(target, 'image.png'), 'utf8'), 'image')
  assert.equal(await pathExists(join(target, 'ignored.txt')), false)
})

test('rolls back files and directories created before a collision', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'notegen-markdown-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const target = join(root, 'target')
  await mkdir(join(source, 'a-new', 'nested'), { recursive: true })
  await mkdir(join(source, 'z-existing'), { recursive: true })
  await mkdir(join(target, 'z-existing'), { recursive: true })
  await writeFile(join(source, 'a-new', 'nested', 'copied.md'), 'copied')
  await writeFile(join(source, 'z-existing', 'collision.md'), 'replacement')
  await writeFile(join(target, 'z-existing', 'collision.md'), 'original')

  await assert.rejects(
    importMarkdownDirectory(source, target, nodeFileSystem),
  )

  assert.equal(await pathExists(join(target, 'a-new')), false)
  assert.equal(
    await readFile(join(target, 'z-existing', 'collision.md'), 'utf8'),
    'original',
  )
})
