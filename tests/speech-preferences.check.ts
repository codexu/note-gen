import assert from 'node:assert/strict'
import test from 'node:test'

const { normalizeSpeechMode } = await import(new URL('../src/lib/speech/preferences.ts', import.meta.url).href)

test('normalizeSpeechMode defaults missing values to auto', () => {
  assert.equal(normalizeSpeechMode(undefined), 'auto')
  assert.equal(normalizeSpeechMode(null), 'auto')
  assert.equal(normalizeSpeechMode(''), 'auto')
})

test('normalizeSpeechMode keeps valid modes and rejects unknown values', () => {
  assert.equal(normalizeSpeechMode('local'), 'local')
  assert.equal(normalizeSpeechMode('model'), 'model')
  assert.equal(normalizeSpeechMode('auto'), 'auto')
  assert.equal(normalizeSpeechMode('unexpected'), 'auto')
})
