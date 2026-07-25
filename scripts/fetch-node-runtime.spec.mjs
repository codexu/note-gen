import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { zipSync } from 'fflate'

import { extractZipEntries } from './fetch-node-runtime.mjs'

const encoder = new TextEncoder()
const runtimeRoot = 'node-v-test-win-x64'
const nodeEntry = `${runtimeRoot}/node.exe`
const licenseEntry = `${runtimeRoot}/LICENSE`

async function withZipFixture(entries, run) {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'note-gen-node-runtime-'))
  const archivePath = path.join(testRoot, 'runtime.zip')
  const destinationDir = path.join(testRoot, 'extract')

  try {
    await fs.writeFile(archivePath, zipSync(entries))
    await fs.mkdir(destinationDir)
    await run({ testRoot, archivePath, destinationDir })
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true })
  }
}

test('extractZipEntries extracts only allow-listed runtime files', async () => {
  await withZipFixture({
    [nodeEntry]: encoder.encode('node-binary'),
    [licenseEntry]: encoder.encode('license'),
    '../../outside.txt': encoder.encode('unsafe'),
    [`${runtimeRoot}/README.md`]: encoder.encode('ignored'),
  }, async ({ testRoot, archivePath, destinationDir }) => {
    await extractZipEntries(archivePath, destinationDir, [nodeEntry, licenseEntry])

    assert.equal(
      await fs.readFile(path.join(destinationDir, runtimeRoot, 'node.exe'), 'utf8'),
      'node-binary',
    )
    assert.equal(
      await fs.readFile(path.join(destinationDir, runtimeRoot, 'LICENSE'), 'utf8'),
      'license',
    )
    await assert.rejects(fs.access(path.join(destinationDir, runtimeRoot, 'README.md')))
    await assert.rejects(fs.access(path.join(testRoot, 'outside.txt')))
  })
})

test('extractZipEntries rejects unsafe expected paths', async () => {
  await withZipFixture({
    [nodeEntry]: encoder.encode('node-binary'),
  }, async ({ archivePath, destinationDir }) => {
    await assert.rejects(
      extractZipEntries(archivePath, destinationDir, ['../node.exe']),
      /Unsafe Node runtime ZIP entry path/,
    )
  })
})

test('extractZipEntries requires every expected entry and never overwrites', async () => {
  await withZipFixture({
    [nodeEntry]: encoder.encode('node-binary'),
  }, async ({ archivePath, destinationDir }) => {
    await assert.rejects(
      extractZipEntries(archivePath, destinationDir, [nodeEntry, licenseEntry]),
      /missing required entry/,
    )

    const outputPath = path.join(destinationDir, runtimeRoot, 'node.exe')
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, 'existing')
    await assert.rejects(
      extractZipEntries(archivePath, destinationDir, [nodeEntry]),
      error => error?.code === 'EEXIST',
    )
    assert.equal(await fs.readFile(outputPath, 'utf8'), 'existing')
  })
})
