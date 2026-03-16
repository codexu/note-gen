import assert from 'node:assert/strict'
import test from 'node:test'

const { resolveSpeechEngine } = await import(new URL('../src/lib/speech/resolver.ts', import.meta.url).href)

test('resolveSpeechEngine prefers local engines in auto mode', () => {
  const result = resolveSpeechEngine('tts', 'auto', {
    localTtsAvailable: true,
    localSttAvailable: false,
    modelTtsAvailable: true,
    modelSttAvailable: false,
  })

  assert.deepEqual(result, {
    available: true,
    engine: 'local',
    reason: 'local-preferred',
  })
})

test('resolveSpeechEngine falls back to model in auto mode when local is unavailable', () => {
  const result = resolveSpeechEngine('stt', 'auto', {
    localTtsAvailable: false,
    localSttAvailable: false,
    modelTtsAvailable: false,
    modelSttAvailable: true,
  })

  assert.deepEqual(result, {
    available: true,
    engine: 'model',
    reason: 'model-fallback',
  })
})

test('resolveSpeechEngine returns unavailable for forced local mode without support', () => {
  const result = resolveSpeechEngine('stt', 'local', {
    localTtsAvailable: false,
    localSttAvailable: false,
    modelTtsAvailable: true,
    modelSttAvailable: true,
  })

  assert.deepEqual(result, {
    available: false,
    engine: 'local',
    reason: 'local-unavailable',
  })
})
