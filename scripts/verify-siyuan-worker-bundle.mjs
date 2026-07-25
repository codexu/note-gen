import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const committedBundle = path.join(
  projectRoot,
  'src-tauri/resources/siyuan-import-worker.bundle.mjs',
)
const tempBundle = path.join(projectRoot, '.cache/siyuan-import-worker.bundle.mjs')

function sha256(filePath) {
  const contents = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(contents).digest('hex')
}

function buildTempBundle() {
  fs.mkdirSync(path.dirname(tempBundle), { recursive: true })
  const result = spawnSync(
    process.execPath,
    ['scripts/build-siyuan-worker.mjs'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        SIYUAN_WORKER_OUTFILE: tempBundle,
      },
      stdio: 'inherit',
    },
  )
  if (result.status !== 0) {
    throw new Error('Failed to build SiYuan import worker bundle for verification')
  }
}

if (!fs.existsSync(committedBundle)) {
  console.error(`Missing committed worker bundle at ${committedBundle}`)
  process.exit(1)
}

buildTempBundle()

const committedHash = sha256(committedBundle)
const builtHash = sha256(tempBundle)

if (committedHash !== builtHash) {
  console.error('SiYuan worker bundle drift detected.')
  console.error(`Committed: ${committedHash}`)
  console.error(`Built:     ${builtHash}`)
  console.error('Run `pnpm build:siyuan-worker` and commit the updated bundle.')
  process.exit(1)
}

console.log(`SiYuan worker bundle matches source (${committedHash.slice(0, 12)}…)`)
