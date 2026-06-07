#!/usr/bin/env node

import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function summarizeInputLogs(logs, metadata = {}) {
  const eventCounts = {}
  const targetSet = new Set()
  const finalValues = {}

  for (const log of logs) {
    if (!log || typeof log !== 'object') continue
    if (log.type) {
      eventCounts[log.type] = (eventCounts[log.type] || 0) + 1
    }
    if (log.target) {
      targetSet.add(log.target)
      if (typeof log.value === 'string') {
        finalValues[log.target] = log.value
      }
    }
  }

  return {
    label: metadata.label,
    appPath: metadata.appPath,
    totalEvents: logs.length,
    eventCounts,
    targets: [...targetSet].sort(),
    finalValues,
  }
}

export function createLogPayload(collector) {
  return {
    metadata: collector.metadata,
    logs: collector.logs,
    summary: collector.summary(),
  }
}

export function createInputLogCollector(metadata = {}) {
  const logs = []
  const collectorMetadata = {
    label: metadata.label || 'doubao-input-debug',
    appPath: metadata.appPath || '',
    startedAt: metadata.startedAt || new Date().toISOString(),
  }
  let server

  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')

    if (url.pathname === '/input-log') {
      const raw = url.searchParams.get('entry') || '{}'
      try {
        const entry = JSON.parse(raw)
        logs.push(entry)
        process.stdout.write(`${JSON.stringify(entry)}\n`)
      } catch {
        const entry = { type: 'collector-parse-error', raw }
        logs.push(entry)
        process.stdout.write(`${JSON.stringify(entry)}\n`)
      }
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      })
      res.end()
      return
    }

    if (url.pathname === '/logs') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      })
      res.end(JSON.stringify(logs, null, 2))
      return
    }

    if (url.pathname === '/summary') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      })
      res.end(JSON.stringify(summarizeInputLogs(logs, collectorMetadata), null, 2))
      return
    }

    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' })
    res.end()
  })

  return {
    metadata: collectorMetadata,
    logs,
    listen({ host = '127.0.0.1', port = 45678 } = {}) {
      return new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen)
        server.listen(port, host, () => {
          server.off('error', rejectListen)
          resolveListen()
        })
      })
    },
    address() {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('collector is not listening on a TCP address')
      }
      return address
    },
    close() {
      return new Promise((resolveClose) => {
        server.close(() => resolveClose())
      })
    },
    summary() {
      return summarizeInputLogs(logs, collectorMetadata)
    },
  }
}

function readArg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

async function runCli() {
  const port = Number(readArg('--port', '45678'))
  const host = readArg('--host', '127.0.0.1')
  const output = readArg('--output', 'tmp/doubao-input-logs.json')
  const appPath = readArg('--app', '')
  const label = readArg('--label', appPath ? 'doubao-input-app' : 'doubao-input-debug')
  const collector = createInputLogCollector({ label, appPath: appPath ? resolve(appPath) : '' })

  await collector.listen({ host, port })
  const url = `http://${host}:${collector.address().port}`
  console.log(`collector listening ${url}`)
  console.log(`logs: ${url}/logs`)
  console.log(`summary: ${url}/summary`)

  if (appPath) {
    spawn('open', ['-n', resolve(appPath)], {
      stdio: 'ignore',
      detached: true,
    }).unref()
    console.log(`opened app: ${resolve(appPath)}`)
  }

  const finish = async () => {
    const outputPath = resolve(output)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, JSON.stringify(createLogPayload(collector), null, 2))
    console.log(`saved ${outputPath}`)
    await collector.close()
    process.exit(0)
  }

  process.once('SIGINT', () => void finish())
  process.once('SIGTERM', () => void finish())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
