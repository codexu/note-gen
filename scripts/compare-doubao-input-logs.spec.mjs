import test from 'node:test'
import assert from 'node:assert/strict'

import { compareInputLogPayloads } from './compare-doubao-input-logs.mjs'

function payload(label, logs) {
  return {
    metadata: { label },
    logs,
    summary: {
      label,
      totalEvents: logs.length,
      eventCounts: logs.reduce((counts, log) => {
        counts[log.type] = (counts[log.type] || 0) + 1
        return counts
      }, {}),
      finalValues: logs.reduce((values, log) => {
        if (log.target && typeof log.value === 'string') {
          values[log.target] = log.value
        }
        return values
      }, {}),
    },
  }
}

test('supports Wry keyDown hypothesis when patched receives input and unpatched does not', () => {
  const result = compareInputLogPayloads({
    unpatched: payload('unpatched-wry', [
      { type: 'manual-voice-attempt-confirmed', target: 'terminal', value: '' },
      { type: 'focus', target: 'textarea#raw-textarea', value: '' },
    ]),
    patched: payload('patched-wry', [
      { type: 'manual-voice-attempt-confirmed', target: 'terminal', value: '' },
      { type: 'focus', target: 'textarea#raw-textarea', value: '' },
      { type: 'beforeinput', target: 'textarea#raw-textarea', value: '', inputType: 'insertText' },
      { type: 'input', target: 'textarea#raw-textarea', value: '豆包语音', inputType: 'insertText' },
    ]),
  })

  assert.equal(result.verdict, 'patched_only_input')
  assert.equal(result.isExperimentValid, true)
  assert.equal(result.supportsWryKeyDownHypothesis, true)
  assert.equal(result.unpatched.inputEvents, 0)
  assert.equal(result.patched.inputEvents, 1)
  assert.equal(result.unpatched.manualVoiceAttemptConfirmed, true)
  assert.equal(result.patched.manualVoiceAttemptConfirmed, true)
})

test('does not support Wry keyDown hypothesis when both builds receive input', () => {
  const result = compareInputLogPayloads({
    unpatched: payload('unpatched-wry', [
      { type: 'manual-voice-attempt-confirmed', target: 'terminal', value: '' },
      { type: 'input', target: 'textarea#raw-textarea', value: 'ok' },
    ]),
    patched: payload('patched-wry', [
      { type: 'manual-voice-attempt-confirmed', target: 'terminal', value: '' },
      { type: 'input', target: 'textarea#raw-textarea', value: 'ok' },
    ]),
  })

  assert.equal(result.verdict, 'both_have_input')
  assert.equal(result.isExperimentValid, true)
  assert.equal(result.supportsWryKeyDownHypothesis, false)
})

test('marks comparison invalid when a manual voice attempt is not confirmed', () => {
  const result = compareInputLogPayloads({
    unpatched: payload('unpatched-wry', [
      { type: 'focus', target: 'textarea#raw-textarea', value: '' },
    ]),
    patched: payload('patched-wry', [
      { type: 'manual-voice-attempt-confirmed', target: 'terminal', value: '' },
      { type: 'input', target: 'textarea#raw-textarea', value: 'ok' },
    ]),
  })

  assert.equal(result.verdict, 'invalid_experiment')
  assert.equal(result.isExperimentValid, false)
  assert.equal(result.supportsWryKeyDownHypothesis, false)
  assert.equal(result.unpatched.manualVoiceAttemptConfirmed, false)
  assert.equal(result.patched.manualVoiceAttemptConfirmed, true)
})
