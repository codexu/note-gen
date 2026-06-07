#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { pathToFileURL } from 'node:url'

const defaultUnpatchedApp = 'src-tauri/target/debug/bundle/macos/NoteGenDoubaoDebug.app'
const defaultPatchedApp = 'src-tauri/target/debug/bundle/macos/NoteGenDoubaoDebugPatched.app'

function joinOutput(outputDir, fileName) {
  return `${outputDir.replace(/\/+$/, '')}/${fileName}`
}

export function buildExperimentPlan({
  outputDir = 'tmp',
  unpatchedApp = defaultUnpatchedApp,
  patchedApp = defaultPatchedApp,
} = {}) {
  const unpatched = joinOutput(outputDir, 'doubao-unpatched-logs.json')
  const patched = joinOutput(outputDir, 'doubao-patched-logs.json')

  return {
    collectors: [
      {
        label: 'unpatched-wry',
        app: unpatchedApp,
        output: unpatched,
      },
      {
        label: 'patched-wry',
        app: patchedApp,
        output: patched,
      },
    ],
    compare: {
      unpatched,
      patched,
    },
  }
}

export function buildManualVoiceAttemptLog({
  label = '',
  time = new Date().toISOString(),
} = {}) {
  return {
    type: 'manual-voice-attempt-confirmed',
    target: 'terminal',
    value: '',
    label,
    time,
  }
}

function readArg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

function runCommand(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
    })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
        resolveRun()
        return
      }
      rejectRun(new Error(`${command} exited with code ${code}`))
    })
  })
}

function startCollector(step) {
  const child = spawn(process.execPath, [
    'scripts/doubao-input-collector.mjs',
    '--label',
    step.label,
    '--app',
    step.app,
    '--output',
    step.output,
  ], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  return child
}

async function postManualVoiceAttempt(step) {
  const entry = buildManualVoiceAttemptLog({ label: step.label })
  const response = await fetch(
    `http://127.0.0.1:45678/input-log?entry=${encodeURIComponent(JSON.stringify(entry))}`,
  )
  if (!response.ok && response.status !== 204) {
    throw new Error(`failed to record manual voice attempt: HTTP ${response.status}`)
  }
}

async function stopCollector(child) {
  if (child.exitCode !== null) return

  await new Promise((resolveStop) => {
    child.once('exit', () => resolveStop())
    child.kill('SIGINT')
  })
}

async function runCollectorStep(step, rl) {
  if (!existsSync(step.app)) {
    throw new Error(`app not found: ${step.app}`)
  }

  await mkdir(dirname(resolve(step.output)), { recursive: true })

  console.log(`\n=== ${step.label} ===`)
  console.log(`app: ${step.app}`)
  console.log(`output: ${step.output}`)
  console.log('在打开的窗口中点 Raw textarea，触发一次豆包语音输入。')

  const child = startCollector(step)
  try {
    await rl.question('确认已经触发豆包语音输入后，按 Enter 保存日志并继续...')
    await postManualVoiceAttempt(step)
  } finally {
    await stopCollector(child)
  }
}

async function runCli() {
  const plan = buildExperimentPlan({
    outputDir: readArg('--output-dir', 'tmp'),
    unpatchedApp: readArg('--unpatched-app', defaultUnpatchedApp),
    patchedApp: readArg('--patched-app', defaultPatchedApp),
  })
  const rl = readline.createInterface({ input, output })

  try {
    for (const step of plan.collectors) {
      await runCollectorStep(step, rl)
    }

    console.log('\n=== compare ===')
    await runCommand(process.execPath, [
      'scripts/compare-doubao-input-logs.mjs',
      '--unpatched',
      plan.compare.unpatched,
      '--patched',
      plan.compare.patched,
    ])
  } finally {
    rl.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
