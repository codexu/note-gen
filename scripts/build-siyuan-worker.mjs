import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outfile = process.env.SIYUAN_WORKER_OUTFILE
  ? path.resolve(process.env.SIYUAN_WORKER_OUTFILE)
  : path.join(projectRoot, 'src-tauri/resources/siyuan-import-worker.bundle.mjs')
const entry = path.join(projectRoot, 'scripts/siyuan-import-worker.mjs')

const aliasArgs = [
  '--alias:@=./src',
  `--alias:@tauri-apps/plugin-fs=${path.join(projectRoot, 'scripts/tauri-fs-shim.mjs')}`,
  `--alias:@tauri-apps/api/path=${path.join(projectRoot, 'scripts/tauri-path-shim.mjs')}`,
]

const esbuildArgs = [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  `--outfile=${outfile}`,
  ...aliasArgs,
  '--packages=external',
]

function runEsbuild(executable, args) {
  return spawnSync(executable, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  })
}

async function buildWithApi() {
  const esbuildPath = path.join(projectRoot, 'node_modules/esbuild/lib/main.js')
  if (!fs.existsSync(esbuildPath)) {
    return false
  }

  const esbuild = await import('esbuild')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    packages: 'external',
    alias: {
      '@': path.join(projectRoot, 'src'),
      '@tauri-apps/plugin-fs': path.join(projectRoot, 'scripts/tauri-fs-shim.mjs'),
      '@tauri-apps/api/path': path.join(projectRoot, 'scripts/tauri-path-shim.mjs'),
    },
  })
  return true
}

if (await buildWithApi()) {
  process.exit(0)
}

const result = runEsbuild(path.join(projectRoot, 'node_modules/.bin/esbuild'), esbuildArgs)

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
