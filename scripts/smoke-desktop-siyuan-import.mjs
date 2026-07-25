import { spawn } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import { register } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
register(pathToFileURL(path.join(projectRoot, 'scripts/tauri-import-hooks.mjs')))

const defaultResourceDir = path.join(projectRoot, 'src-tauri/resources')
const defaultFixtureRoot = path.join(projectRoot, 'tests/fixtures/siyuan-realistic')
const minimalFixtureRoot = path.join(projectRoot, 'tests/fixtures/siyuan-minimal')
const defaultExtractedRoot = path.join(projectRoot, '.test-siyuan-import/extracted')
const defaultOutputDir = path.join(projectRoot, '.test-siyuan-import/output-desktop-smoke')

function parseArgs(argv) {
  return {
    verifyOnly: argv.includes('--verify-only'),
    cancelSmoke: argv.includes('--cancel-smoke'),
  }
}

function formatSeconds(ms) {
  return Math.round((ms / 1000) * 10) / 10
}

function existsSync(target) {
  try {
    fsSync.accessSync(target)
    return true
  } catch {
    return false
  }
}

function resolveResourceDirFromAppBundle(appBundle) {
  const candidates = [
    path.join(appBundle, 'Contents/Resources/resources'),
    path.join(appBundle, 'resources'),
    path.join(appBundle, 'usr/lib/note-gen/resources'),
    path.join(appBundle, 'resources/resources'),
  ]
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'siyuan-import-worker.bundle.mjs'))) {
      return candidate
    }
  }
  return null
}

function resolveResourceDir() {
  if (process.env.RESOURCE_DIR) {
    return path.resolve(process.env.RESOURCE_DIR)
  }

  if (process.env.APP_BUNDLE) {
    const resolved = resolveResourceDirFromAppBundle(path.resolve(process.env.APP_BUNDLE))
    if (resolved) {
      return resolved
    }
    throw new Error(`Could not locate bundled resources inside APP_BUNDLE=${process.env.APP_BUNDLE}`)
  }

  if (process.env.CI === 'true') {
    throw new Error('CI smoke requires APP_BUNDLE or RESOURCE_DIR (refusing source-tree fallback)')
  }

  return defaultResourceDir
}

function nodeBinary(resourceDir) {
  return process.platform === 'win32'
    ? path.join(resourceDir, 'node-runtime/node.exe')
    : path.join(resourceDir, 'node-runtime/node')
}

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

async function resolveArchiveRoot(extractedDir) {
  const entries = await fs.readdir(extractedDir, { withFileTypes: true })
  const rootDirs = entries.filter(entry => entry.isDirectory())
  if (rootDirs.length !== 1) {
    throw new Error(`Expected one extracted root directory, found ${rootDirs.length}`)
  }
  return path.join(extractedDir, rootDirs[0].name)
}

async function countMarkdownFiles(rootDir) {
  let count = 0

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else if (entry.name.endsWith('.md')) {
        count += 1
      }
    }
  }

  await walk(rootDir)
  return count
}

async function verifyBundledRuntime({ resourceDir, nodeExecutable, workerScript }) {
  const manifestPath = path.join(resourceDir, 'node-runtime/manifest.json')
  if (!await pathExists(manifestPath)) {
    throw new Error(`Missing Node runtime manifest: ${manifestPath}`)
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const expectedTarget = process.env.NODE_RUNTIME_TARGET
  if (expectedTarget && manifest.targetTriple && manifest.targetTriple !== expectedTarget) {
    throw new Error(
      `Bundled Node target mismatch: expected ${expectedTarget}, found ${manifest.targetTriple}`,
    )
  }

  const versionResult = await runCommand(nodeExecutable, ['--version'], { cwd: resourceDir })
  if (versionResult.code !== 0) {
    throw new Error(`Bundled Node failed to start: ${versionResult.stderr.trim()}`)
  }

  return {
    nodeVersion: versionResult.stdout.trim(),
    manifest,
    workerScript,
  }
}

function parseEnvelopes(stdout) {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

async function countImportableSourceDocuments(dataRoot) {
  const { countImportableSyDocuments } = await import('../src/lib/import/siyuan/document-discovery.ts')
  return countImportableSyDocuments(dataRoot)
}

function assertImportDocumentAccounting(sourceSyCount, result) {
  const accounted = result.successCount
    + result.failedCount
    + result.degradedCount
    + result.unsupportedCount

  if (result.omittedDocumentCount > 0) {
    throw new Error(`Import omitted ${result.omittedDocumentCount} document(s)`)
  }
  if (result.discoveredDocumentCount !== sourceSyCount) {
    throw new Error(
      `Discovered document mismatch: archive has ${sourceSyCount}, `
      + `importer discovered ${result.discoveredDocumentCount}`,
    )
  }
  if (result.totalDocuments !== sourceSyCount) {
    throw new Error(
      `Reported document mismatch: archive has ${sourceSyCount}, `
      + `result totalDocuments is ${result.totalDocuments}`,
    )
  }
  if (accounted !== sourceSyCount) {
    throw new Error(
      `Status accounting mismatch: archive has ${sourceSyCount}, `
      + `success+failed+degraded+unsupported=${accounted}`,
    )
  }
}

async function runFullImportSmoke({
  nodeExecutable,
  workerScript,
  resourceDir,
  extractedDir,
  outputDir,
}) {
  const dataRoot = await resolveArchiveRoot(extractedDir)
  const sourceSyCount = await countImportableSourceDocuments(dataRoot)
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const started = Date.now()
  const { code, stdout, stderr } = await runCommand(
    nodeExecutable,
    [workerScript, '--data-root', dataRoot, '--target-dir', outputDir],
    { cwd: resourceDir },
  )

  if (stderr.trim()) {
    console.error('Worker stderr:')
    console.error(stderr.trim())
  }

  if (code !== 0) {
    throw new Error(`Production worker exited with code ${code}`)
  }

  const envelopes = parseEnvelopes(stdout)
  const resultEnvelope = envelopes.find(entry => entry.type === 'result')
  const errorEnvelope = envelopes.find(entry => entry.type === 'error')

  if (errorEnvelope) {
    throw new Error(errorEnvelope.message ?? 'Production worker reported an error')
  }
  if (!resultEnvelope?.payload) {
    throw new Error('Production worker did not emit a result payload')
  }

  const result = resultEnvelope.payload
  const markdownCount = await countMarkdownFiles(outputDir)
  assertImportDocumentAccounting(sourceSyCount, result)

  console.log(JSON.stringify({
    phase: 'full-import',
    elapsedSeconds: formatSeconds(Date.now() - started),
    workerExitCode: code,
    progressEvents: envelopes.filter(entry => entry.type === 'progress').length,
    sourceSyDocuments: sourceSyCount,
    notebookCount: result.notebookCount,
    totalDocuments: result.totalDocuments,
    discoveredDocumentCount: result.discoveredDocumentCount,
    omittedDocumentCount: result.omittedDocumentCount,
    successCount: result.successCount,
    failedCount: result.failedCount,
    degradedCount: result.degradedCount,
    unsupportedCount: result.unsupportedCount,
    assetCount: result.assetCount,
    outputMarkdownFiles: markdownCount,
  }, null, 2))

  if (markdownCount === 0) {
    throw new Error('Smoke test produced no Markdown files')
  }

  const writtenMarkdownDocuments = result.successCount + result.degradedCount + result.unsupportedCount
  if (markdownCount !== writtenMarkdownDocuments) {
    throw new Error(
      `Markdown output mismatch: expected ${writtenMarkdownDocuments} written notes, `
      + `found ${markdownCount} Markdown files`,
    )
  }
}

async function runCancelImportSmoke({
  nodeExecutable,
  workerScript,
  resourceDir,
  extractedDir,
  outputDir,
}) {
  const dataRoot = await resolveArchiveRoot(extractedDir)
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const child = spawn(
    nodeExecutable,
    [workerScript, '--data-root', dataRoot, '--target-dir', outputDir],
    {
      cwd: resourceDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  let stdout = ''
  let stderr = ''
  let cancelSent = false

  const sendCancel = () => {
    if (cancelSent || child.killed) {
      return
    }
    cancelSent = true
    child.stdin.write('cancel\n')
    child.stdin.end()
  }

  child.stdout.on('data', chunk => {
    stdout += chunk.toString()
    if (!cancelSent && /"type":"progress"/.test(stdout)) {
      sendCancel()
    }
  })
  child.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
    sendCancel()
  })

  if (stderr.trim()) {
    console.error('Worker stderr:')
    console.error(stderr.trim())
  }

  const envelopes = parseEnvelopes(stdout)
  const cancelledEnvelope = envelopes.find(entry => entry.type === 'cancelled')
  if (!cancelledEnvelope) {
    throw new Error('Production worker did not acknowledge cancel with a cancelled envelope')
  }

  const markdownCount = await countMarkdownFiles(outputDir)
  console.log(JSON.stringify({
    phase: 'cancel-import',
    workerExitCode: exitCode,
    cancelled: true,
    rolledBack: cancelledEnvelope.payload?.rolledBack ?? false,
    outputMarkdownFiles: markdownCount,
  }, null, 2))

  if (markdownCount !== 0) {
    throw new Error(`Cancel smoke left ${markdownCount} Markdown file(s) in the output directory`)
  }
}

async function main() {
  const { verifyOnly, cancelSmoke } = parseArgs(process.argv.slice(2))
  const resourceDir = resolveResourceDir()
  const nodeExecutable = nodeBinary(resourceDir)
  const workerScript = path.join(resourceDir, 'siyuan-import-worker.bundle.mjs')

  console.log('Desktop SiYuan import smoke test')
  console.log(`  mode:         ${verifyOnly ? 'verify-only' : cancelSmoke ? 'cancel-import' : 'full-import'}`)
  console.log(`  resource dir: ${resourceDir}`)
  console.log(`  node binary:  ${nodeExecutable}`)
  console.log(`  worker:       ${workerScript}`)

  for (const requiredPath of [nodeExecutable, workerScript]) {
    if (!await pathExists(requiredPath)) {
      throw new Error(`Missing required production asset: ${requiredPath}`)
    }
  }

  if (process.platform !== 'win32') {
    await fs.chmod(nodeExecutable, 0o755).catch(() => {})
  }

  const runtime = await verifyBundledRuntime({ resourceDir, nodeExecutable, workerScript })
  console.log(JSON.stringify({
    phase: 'verify-runtime',
    nodeVersion: runtime.nodeVersion,
    targetTriple: runtime.manifest.targetTriple ?? runtime.manifest.platform,
    workerBundle: path.basename(workerScript),
  }, null, 2))

  if (verifyOnly) {
    return
  }

  const fixtureRoots = process.env.SIYUAN_FIXTURES
    ? process.env.SIYUAN_FIXTURES.split(path.delimiter).map(entry => path.resolve(entry.trim()))
    : process.env.EXTRACTED_DIR
      ? [path.resolve(process.env.EXTRACTED_DIR)]
      : process.env.CI === 'true'
        ? [defaultFixtureRoot, minimalFixtureRoot]
        : [defaultExtractedRoot]

  const outputDir = process.env.OUTPUT_DIR
    ? path.resolve(process.env.OUTPUT_DIR)
    : defaultOutputDir

  for (const extractedDir of fixtureRoots) {
    if (!await pathExists(extractedDir)) {
      throw new Error(`Missing extracted archive directory for import smoke: ${extractedDir}`)
    }

    const fixtureOutputDir = fixtureRoots.length > 1
      ? path.join(outputDir, path.basename(extractedDir))
      : outputDir

    console.log(`  extracted:    ${extractedDir}`)
    console.log(`  output:       ${fixtureOutputDir}`)

    if (cancelSmoke) {
      await runCancelImportSmoke({
        nodeExecutable,
        workerScript,
        resourceDir,
        extractedDir,
        outputDir: fixtureOutputDir,
      })
      continue
    }

    await runFullImportSmoke({
      nodeExecutable,
      workerScript,
      resourceDir,
      extractedDir,
      outputDir: fixtureOutputDir,
    })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
