import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

import {
  createInputLogCollector,
  createLogPayload,
  summarizeInputLogs,
} from './doubao-input-collector.mjs'

test('summarizes input logs by event count, target, and final value', () => {
  const summary = summarizeInputLogs([
    { type: 'focus', target: 'textarea#raw-textarea', value: '' },
    { type: 'beforeinput', target: 'textarea#raw-textarea', inputType: 'insertText', data: '测' },
    { type: 'input', target: 'textarea#raw-textarea', inputType: 'insertText', data: '测', value: '测' },
  ])

  assert.deepEqual(summary.eventCounts, {
    focus: 1,
    beforeinput: 1,
    input: 1,
  })
  assert.deepEqual(summary.targets, ['textarea#raw-textarea'])
  assert.deepEqual(summary.finalValues, {
    'textarea#raw-textarea': '测',
  })
})

test('collector stores image-beacon input logs and exposes summary', async () => {
  const collector = createInputLogCollector()
  await collector.listen({ host: '127.0.0.1', port: 0 })

  try {
    const { port } = collector.address()
    const entry = {
      type: 'input',
      target: 'textarea#raw-textarea',
      value: 'voice text',
      inputType: 'insertText',
      data: 'voice text',
    }
    const response = await fetch(
      `http://127.0.0.1:${port}/input-log?entry=${encodeURIComponent(JSON.stringify(entry))}`,
    )
    assert.equal(response.status, 204)

    const logs = await fetch(`http://127.0.0.1:${port}/logs`).then((res) => res.json())
    assert.deepEqual(logs, [entry])

    const summary = await fetch(`http://127.0.0.1:${port}/summary`).then((res) => res.json())
    assert.equal(summary.totalEvents, 1)
    assert.deepEqual(summary.eventCounts, { input: 1 })
    assert.deepEqual(summary.finalValues, {
      'textarea#raw-textarea': 'voice text',
    })
  } finally {
    await collector.close()
  }
})

test('collector summary and saved payload include experiment metadata', async () => {
  const collector = createInputLogCollector({
    label: 'patched-wry',
    appPath: '/tmp/NoteGenDoubaoDebugPatched.app',
  })
  await collector.listen({ host: '127.0.0.1', port: 0 })

  try {
    const { port } = collector.address()
    await fetch(
      `http://127.0.0.1:${port}/input-log?entry=${encodeURIComponent(JSON.stringify({
        type: 'input',
        target: 'textarea#raw-textarea',
        value: 'patched voice',
      }))}`,
    )

    const summary = await fetch(`http://127.0.0.1:${port}/summary`).then((res) => res.json())
    assert.equal(summary.label, 'patched-wry')
    assert.equal(summary.appPath, '/tmp/NoteGenDoubaoDebugPatched.app')

    const payload = createLogPayload(collector)
    assert.equal(payload.metadata.label, 'patched-wry')
    assert.equal(payload.metadata.appPath, '/tmp/NoteGenDoubaoDebugPatched.app')
    assert.equal(payload.summary.finalValues['textarea#raw-textarea'], 'patched voice')
  } finally {
    await collector.close()
  }
})

test('collector module can be dynamically imported without a script argv', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', 'import("./scripts/doubao-input-collector.mjs").then(() => console.log("import-ok"))'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /import-ok/)
})
