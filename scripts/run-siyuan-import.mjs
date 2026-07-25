import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const zipPath = process.argv[2] ?? path.join(process.env.HOME ?? '', 'Desktop', 'Security.sy.zip')
const testRoot = path.join(projectRoot, '.test-siyuan-import')
const extractedDir = path.join(testRoot, 'extracted')
const outputDir = path.join(testRoot, 'output-smoke')
const extractMarker = path.join(testRoot, '.extract-source')

register(pathToFileURL(path.join(projectRoot, 'scripts/tauri-import-hooks.mjs')))

function formatSeconds(ms) {
  return Math.round((ms / 1000) * 10) / 10
}

async function ensureExtracted() {
  const existingSource = await fs.readFile(extractMarker, 'utf8').catch(() => null)
  const entries = await fs.readdir(extractedDir).catch(() => [])

  if (existingSource === zipPath && entries.length > 0) {
    console.log(`Reusing extracted archive at ${extractedDir}`)
    return
  }

  await fs.rm(extractedDir, { recursive: true, force: true })
  await fs.mkdir(extractedDir, { recursive: true })

  console.log(`Extracting ${zipPath} ...`)
  const extractStarted = Date.now()
  const result = spawnSync('unzip', ['-q', zipPath, '-d', extractedDir], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`unzip failed with exit code ${result.status ?? 'unknown'}`)
  }
  await fs.writeFile(extractMarker, zipPath, 'utf8')
  console.log(`Extract finished in ${formatSeconds(Date.now() - extractStarted)}s`)
}

async function countOutput(outputPath) {
  let mdFiles = 0
  let assetFiles = 0
  let totalBytes = 0

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }
      const stats = await fs.stat(entryPath)
      totalBytes += stats.size
      if (entry.name.endsWith('.md')) {
        mdFiles += 1
      } else if (entryPath.includes(`${path.sep}assets${path.sep}`)) {
        assetFiles += 1
      }
    }
  }

  await walk(outputPath)
  return { mdFiles, assetFiles, totalBytes }
}

async function main() {
  if (!zipPath.toLowerCase().endsWith('.sy.zip')) {
    throw new Error(`Expected a .sy.zip archive, got: ${zipPath}`)
  }

  await fs.access(zipPath)
  await ensureExtracted()
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const { importSiYuanData, resolveSiYuanArchiveRoot } = await import('../src/lib/import/siyuan/index.ts')
  const dataRoot = await resolveSiYuanArchiveRoot(extractedDir)

  console.log(`Importing from ${dataRoot}`)
  console.log(`Writing to ${outputDir}`)

  const importStarted = Date.now()
  const result = await importSiYuanData({
    dataRoot,
    targetDir: outputDir,
    onProgress: progress => {
      if (progress.phase === 'importing' || progress.phase === 'indexing') {
        process.stdout.write(`\r${progress.phase}: ${progress.current}/${progress.total} ${progress.currentTitle ?? ''}`.padEnd(100))
      }
    },
  })
  process.stdout.write('\n')

  const outputStats = await countOutput(outputDir)
  const nonSuccess = result.documents.filter(document => document.status !== 'success')

  console.log(JSON.stringify({
    elapsedSeconds: formatSeconds(Date.now() - importStarted),
    notebookCount: result.notebookCount,
    totalDocuments: result.totalDocuments,
    successCount: result.successCount,
    failedCount: result.failedCount,
    degradedCount: result.degradedCount,
    unsupportedCount: result.unsupportedCount,
    assetCount: result.assetCount,
    outputMdFiles: outputStats.mdFiles,
    outputAssetFiles: outputStats.assetFiles,
    outputBytes: outputStats.totalBytes,
    nonSuccess: nonSuccess.map(document => ({
      title: document.title,
      status: document.status,
      issues: document.issues,
      errorMessage: document.errorMessage,
    })),
  }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
