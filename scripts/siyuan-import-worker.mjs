import readline from 'node:readline'
import { importSiYuanData } from '../src/lib/import/siyuan/index.ts'
import { SyImportAbortedError } from '../src/lib/import/siyuan/budgets.ts'

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--data-root') {
      options.dataRoot = argv[index + 1]
      index += 1
      continue
    }
    if (arg === '--target-dir') {
      options.targetDir = argv[index + 1]
      index += 1
      continue
    }
    if (arg === '--assets-dir-name') {
      options.assetsDirName = argv[index + 1]
      index += 1
    }
  }
  return options
}

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function emitProgress(progress) {
  emit({ type: 'progress', payload: progress })
}

function emitError(error) {
  const message = error instanceof Error ? error.message : String(error)
  emit({ type: 'error', message })
}

function listenForCancel(abortController) {
  if (process.stdin.isTTY) {
    return () => {}
  }

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  rl.on('line', line => {
    if (line.trim() === 'cancel') {
      abortController.abort()
    }
  })

  return () => rl.close()
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.dataRoot || !options.targetDir) {
    throw new Error('Missing required --data-root or --target-dir')
  }

  const abortController = new AbortController()
  const stopListening = listenForCancel(abortController)

  try {
    const result = await importSiYuanData({
      dataRoot: options.dataRoot,
      targetDir: options.targetDir,
      assetsDirName: options.assetsDirName,
      signal: abortController.signal,
      onProgress: emitProgress,
    })
    emit({ type: 'result', payload: result })
  } catch (error) {
    if (error instanceof SyImportAbortedError) {
      emit({ type: 'cancelled', payload: { rolledBack: true } })
      return
    }
    throw error
  } finally {
    stopListening()
  }
}

main().catch(error => {
  emitError(error)
  process.exitCode = 1
})
