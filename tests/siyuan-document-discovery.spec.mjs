import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import { register } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
register(pathToFileURL(path.join(projectRoot, 'scripts/tauri-import-hooks.mjs')))

const realisticFixtureRoot = path.join(
  projectRoot,
  'tests/fixtures/siyuan-realistic/RealisticExport',
)

test('realistic export counts root documents and verified notebooks separately', async () => {
  const {
    countImportableSyDocuments,
    countRootLevelSyFiles,
    listVerifiedNotebookDirectories,
  } = await import('../src/lib/import/siyuan/document-discovery.ts')

  assert.equal(await countRootLevelSyFiles(realisticFixtureRoot), 1)
  assert.equal((await listVerifiedNotebookDirectories(realisticFixtureRoot)).length, 1)
  assert.equal(await countImportableSyDocuments(realisticFixtureRoot), 3)
})

test('document child directories without notebook conf are not treated as notebooks', async () => {
  const { hasSiYuanNotebookMarker } = await import('../src/lib/import/siyuan/utils.ts')
  const childDir = path.join(realisticFixtureRoot, '20260101120000-rootdc1')
  const notebookDir = path.join(realisticFixtureRoot, '20260101120000-notebk1')

  assert.equal(await hasSiYuanNotebookMarker(childDir), false)
  assert.equal(await hasSiYuanNotebookMarker(notebookDir), true)
})

test('realistic export fixture keeps root and child sy files on disk', async () => {
  await fs.access(path.join(realisticFixtureRoot, '20260101120000-rootdc1.sy'))
  await fs.access(path.join(
    realisticFixtureRoot,
    '20260101120000-rootdc1/20260101120001-child01.sy',
  ))
  await fs.access(path.join(
    realisticFixtureRoot,
    '20260101120000-notebk1/20260101120002-nbkdoc1.sy',
  ))
})

async function writeMinimalSyFile(dir, documentId, title = documentId) {
  const paragraphId = documentId.replace(/(wide|doc|leaf)(\d+)$/, 'para$2')
  const payload = {
    Type: 'NodeDocument',
    ID: documentId,
    Properties: {
      id: documentId,
      title,
      type: 'doc',
    },
    Children: [
      {
        Type: 'NodeParagraph',
        ID: paragraphId,
        Properties: { id: paragraphId },
        Children: [{ Type: 'NodeText', Data: title }],
      },
    ],
  }
  await fs.writeFile(path.join(dir, `${documentId}.sy`), JSON.stringify(payload))
}

test('discovers deep linked document trees without revisiting child directories', async () => {
  const { discoverSyPathsInNotebookTree } = await import('../src/lib/import/siyuan/document-discovery.ts')
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'siyuan-deep-'))
  const depth = 30
  let currentDir = tempRoot
  const directoryVisits = []

  try {
    for (let index = 0; index < depth; index += 1) {
      const documentId = `2026010112${String(index).padStart(4, '0')}-doc${String(index).padStart(4, '0')}`
      await writeMinimalSyFile(currentDir, documentId, `Depth ${index}`)
      const childDir = path.join(currentDir, documentId)
      await fs.mkdir(childDir)
      currentDir = childDir
    }

    const leafId = `2026010112${String(depth).padStart(4, '0')}-leaf${String(depth).padStart(4, '0')}`
    await writeMinimalSyFile(currentDir, leafId, 'Leaf')

    const discovered = await discoverSyPathsInNotebookTree(tempRoot, {
      onDirectoryEnter: dir => directoryVisits.push(dir),
    })

    assert.equal(discovered.length, depth + 1)
    assert.equal(directoryVisits.length, depth + 1)
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('discovers wide flat document trees within node budget', async () => {
  const { discoverSyPathsInNotebookTree } = await import('../src/lib/import/siyuan/document-discovery.ts')
  const { ImportBudgetTracker } = await import('../src/lib/import/siyuan/budgets.ts')
  const { parseAndValidateSiYuanDocument } = await import('../src/lib/import/siyuan/validation.ts')

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'siyuan-wide-'))
  const documentCount = 250

  try {
    for (let index = 0; index < documentCount; index += 1) {
      const documentId = `2026010212${String(index).padStart(4, '0')}-wide${String(index).padStart(4, '0')}`
      await writeMinimalSyFile(tempRoot, documentId, `Wide ${index}`)
    }

    const discovered = await discoverSyPathsInNotebookTree(tempRoot)
    assert.equal(discovered.length, documentCount)

    const budget = new ImportBudgetTracker()
    for (const syPath of discovered) {
      const content = await fs.readFile(syPath, 'utf8')
      const document = parseAndValidateSiYuanDocument(content, syPath)
      budget.trackDocument(document, content.length)
    }

    assert.equal(budget.documentCount, documentCount)
    assert.ok(budget.totalNodes > documentCount)
    assert.ok(budget.totalNodes < 1_000_000)
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})
