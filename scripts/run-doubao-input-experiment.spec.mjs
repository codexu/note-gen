import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildExperimentPlan,
  buildManualVoiceAttemptLog,
} from './run-doubao-input-experiment.mjs'

test('builds the default unpatched and patched Doubao experiment plan', () => {
  const plan = buildExperimentPlan()

  assert.equal(plan.collectors.length, 2)
  assert.deepEqual(plan.collectors.map((step) => step.label), [
    'unpatched-wry',
    'patched-wry',
  ])
  assert.equal(plan.collectors[0].output, 'tmp/doubao-unpatched-logs.json')
  assert.equal(plan.collectors[1].output, 'tmp/doubao-patched-logs.json')
  assert.equal(plan.compare.unpatched, 'tmp/doubao-unpatched-logs.json')
  assert.equal(plan.compare.patched, 'tmp/doubao-patched-logs.json')
})

test('allows custom output directory for experiment artifacts', () => {
  const plan = buildExperimentPlan({ outputDir: 'tmp/custom-doubao' })

  assert.equal(plan.collectors[0].output, 'tmp/custom-doubao/doubao-unpatched-logs.json')
  assert.equal(plan.collectors[1].output, 'tmp/custom-doubao/doubao-patched-logs.json')
  assert.equal(plan.compare.unpatched, 'tmp/custom-doubao/doubao-unpatched-logs.json')
  assert.equal(plan.compare.patched, 'tmp/custom-doubao/doubao-patched-logs.json')
})

test('builds a manual voice attempt marker for confirmed experiment segments', () => {
  const marker = buildManualVoiceAttemptLog({
    label: 'patched-wry',
    time: '2026-06-07T00:00:00.000Z',
  })

  assert.deepEqual(marker, {
    type: 'manual-voice-attempt-confirmed',
    target: 'terminal',
    value: '',
    label: 'patched-wry',
    time: '2026-06-07T00:00:00.000Z',
  })
})
