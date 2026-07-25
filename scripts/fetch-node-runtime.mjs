import { createHash } from 'node:crypto'
import { createWriteStream, createReadStream, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { unzip } from 'fflate'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(projectRoot, 'src-tauri/resources/node-runtime')
const manifest = JSON.parse(
  await fs.readFile(path.join(projectRoot, 'scripts/node-runtime-targets.json'), 'utf8'),
)

const MOBILE_TARGET_MARKERS = ['-android', '-ios', 'apple-ios', 'apple-android']
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 300 * 1024 * 1024

function parseArgs(argv) {
  const options = { target: null, force: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--target') {
      options.target = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg === '--force') {
      options.force = true
    }
  }
  return options
}

function hostTargetTriple() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu'
  }
  if (process.platform === 'win32') {
    return 'x86_64-pc-windows-msvc'
  }
  throw new Error(`Unsupported host platform for bundled Node runtime: ${process.platform}`)
}

function isMobileTargetTriple(targetTriple) {
  return MOBILE_TARGET_MARKERS.some(marker => targetTriple.includes(marker))
}

function resolveTargetTriple(explicitTarget) {
  const explicitCandidates = [
    explicitTarget,
    process.env.NODE_RUNTIME_TARGET,
    process.env.CARGO_BUILD_TARGET,
    process.env.TAURI_ENV_TARGET_TRIPLE,
  ].filter(Boolean)

  for (const candidate of explicitCandidates) {
    if (isMobileTargetTriple(candidate)) {
      console.log(`Skipping bundled Node runtime fetch for mobile target: ${candidate}`)
      process.exit(0)
    }
    if (!manifest.targets[candidate]) {
      throw new Error(
        `Unsupported explicit Node runtime target "${candidate}". Expected one of ${Object.keys(manifest.targets).join(', ')}`,
      )
    }
    return candidate
  }

  const host = hostTargetTriple()
  if (!manifest.targets[host]) {
    throw new Error(
      `Unsupported host Node runtime target "${host}". Expected one of ${Object.keys(manifest.targets).join(', ')}`,
    )
  }
  return host
}

function assertAllowedUrl(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith(manifest.allowedHostSuffix)) {
    throw new Error(`Refusing to download Node runtime from untrusted host: ${url}`)
  }
}

async function downloadToFile(url, destination) {
  assertAllowedUrl(url)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Node runtime (${response.status}) from ${url}`)
  }
  assertAllowedUrl(response.url)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await pipeline(response.body, createWriteStream(destination))
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function extractTarGz(archivePath, destinationDir) {
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destinationDir], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error('Failed to extract Node runtime archive')
  }
}

function validateArchiveEntryName(entryName) {
  if (
    !entryName
    || entryName.includes('\\')
    || entryName.startsWith('/')
    || /^[A-Za-z]:/.test(entryName)
  ) {
    throw new Error(`Unsafe Node runtime ZIP entry path: ${entryName}`)
  }

  const segments = entryName.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe Node runtime ZIP entry path: ${entryName}`)
  }
  return segments
}

function unzipSelectedEntries(archiveData, expectedEntries) {
  const expected = new Set(expectedEntries)
  const oversizedEntries = new Set()

  return new Promise((resolve, reject) => {
    unzip(archiveData, {
      filter(entry) {
        if (!expected.has(entry.name)) {
          return false
        }
        if (entry.originalSize > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) {
          oversizedEntries.add(entry.name)
          return false
        }
        return true
      },
    }, (error, entries) => {
      if (error) {
        reject(error)
        return
      }
      if (oversizedEntries.size > 0) {
        reject(new Error(
          `Node runtime ZIP entry exceeds size limit: ${[...oversizedEntries].join(', ')}`,
        ))
        return
      }
      resolve(entries)
    })
  })
}

export async function extractZipEntries(archivePath, destinationDir, expectedEntries) {
  const normalizedEntries = expectedEntries.map(entryName => {
    const segments = validateArchiveEntryName(entryName)
    return { entryName, segments }
  })
  const archiveData = await fs.readFile(archivePath)
  const entries = await unzipSelectedEntries(
    archiveData,
    normalizedEntries.map(entry => entry.entryName),
  )

  let totalUncompressedBytes = 0
  for (const { entryName, segments } of normalizedEntries) {
    const contents = entries[entryName]
    if (!contents) {
      throw new Error(`Node runtime ZIP is missing required entry: ${entryName}`)
    }
    totalUncompressedBytes += contents.byteLength
    if (totalUncompressedBytes > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('Node runtime ZIP exceeds total extraction size limit')
    }

    const outputPath = path.join(destinationDir, ...segments)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, contents, { flag: 'wx' })
  }
}

async function readStoredManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    return null
  }
  try {
    return JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

async function runtimeAlreadyValid(targetTriple, outputNode, manifestPath, force) {
  if (force) {
    return false
  }
  const stored = await readStoredManifest(manifestPath)
  if (!stored || stored.targetTriple !== targetTriple || !existsSync(outputNode)) {
    return false
  }
  const binaryHash = await sha256File(outputNode)
  return binaryHash === stored.binarySha256
}

async function main() {
  const { target: explicitTarget, force } = parseArgs(process.argv.slice(2))
  const targetTriple = resolveTargetTriple(explicitTarget)
  const target = manifest.targets[targetTriple]
  const archiveUrl = `${manifest.baseUrl}${target.archive}`
  const cacheDir = path.join(runtimeRoot, '.cache')
  const archivePath = path.join(cacheDir, target.archive)
  const extractDir = path.join(cacheDir, 'extract')
  const extractedNode = path.join(extractDir, ...target.binaryPath)
  const nodeBinaryName = targetTriple.includes('windows') ? 'node.exe' : 'node'
  const outputNode = path.join(runtimeRoot, nodeBinaryName)
  const staleNode = path.join(runtimeRoot, nodeBinaryName === 'node.exe' ? 'node' : 'node.exe')
  const manifestPath = path.join(runtimeRoot, 'manifest.json')
  const licensePath = path.join(runtimeRoot, 'LICENSE')
  const sbomPath = path.join(runtimeRoot, 'SBOM.json')

  if (await runtimeAlreadyValid(targetTriple, outputNode, manifestPath, force)) {
    await fs.rm(staleNode, { force: true })
    console.log(`Reusing verified Node ${manifest.version} runtime for ${targetTriple}`)
    return
  }

  await fs.mkdir(runtimeRoot, { recursive: true })
  await fs.mkdir(cacheDir, { recursive: true })

  await downloadToFile(archiveUrl, archivePath)
  const archiveHash = await sha256File(archivePath)
  if (archiveHash !== target.sha256) {
    throw new Error(
      `Node runtime archive SHA-256 mismatch for ${target.archive}. Expected ${target.sha256}, got ${archiveHash}`,
    )
  }

  await fs.rm(extractDir, { recursive: true, force: true })
  await fs.mkdir(extractDir, { recursive: true })
  if (target.archive.endsWith('.zip')) {
    await extractZipEntries(archivePath, extractDir, [
      target.binaryPath.join('/'),
      `${target.binaryPath[0]}/LICENSE`,
    ])
  } else {
    await extractTarGz(archivePath, extractDir)
  }

  const extractedLicense = path.join(extractDir, target.binaryPath[0], 'LICENSE')
  if (existsSync(extractedLicense)) {
    await fs.copyFile(extractedLicense, licensePath)
  } else {
    await fs.writeFile(
      licensePath,
      'Node.js is licensed under the MIT License. See https://github.com/nodejs/node/blob/main/LICENSE\n',
    )
  }

  if (!existsSync(extractedNode)) {
    throw new Error(`Node binary not found after extraction: ${extractedNode}`)
  }

  await fs.copyFile(extractedNode, outputNode)
  await fs.rm(staleNode, { force: true })
  if (process.platform !== 'win32') {
    await fs.chmod(outputNode, 0o755)
  }

  const binaryHash = await sha256File(outputNode)
  const sbom = {
    schema: 'note-gen/node-runtime/1',
    component: 'nodejs',
    version: manifest.version,
    targetTriple,
    nodeTag: target.nodeTag,
    archive: target.archive,
    archiveSha256: archiveHash,
    binary: nodeBinaryName,
    binarySha256: binaryHash,
    sourceUrl: archiveUrl,
    licensePath: 'LICENSE',
    fetchedAt: new Date().toISOString(),
  }

  await fs.writeFile(manifestPath, `${JSON.stringify({
    version: manifest.version,
    targetTriple,
    platform: target.nodeTag,
    binary: nodeBinaryName,
    archiveSha256: archiveHash,
    binarySha256: binaryHash,
  }, null, 2)}\n`)
  await fs.writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`)

  await fs.rm(cacheDir, { recursive: true, force: true })
  console.log(`Bundled Node ${manifest.version} (${targetTriple}) at ${outputNode}`)
}

const isDirectInvocation = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectInvocation) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
