import assert from 'node:assert/strict'
import test from 'node:test'

const { resolvePreferredSpeechEngine, shouldFallbackToModelAfterLocalFailure } = await import(new URL('../src/lib/speech/runtime.ts', import.meta.url).href)

test('resolvePreferredSpeechEngine uses auto mode defaults for read aloud', () => {
  const resolution = resolvePreferredSpeechEngine('tts', {
    audioModel: 'provider-tts',
    sttModel: '',
    textToSpeechMode: 'auto',
    speechToTextMode: 'auto',
  }, {
    localTtsAvailable: true,
    localSttAvailable: false,
    modelTtsAvailable: true,
    modelSttAvailable: false,
  })

  assert.deepEqual(resolution, {
    available: true,
    engine: 'local',
    reason: 'local-preferred',
  })
})

test('resolvePreferredSpeechEngine uses speech-to-text mode for recordings', () => {
  const resolution = resolvePreferredSpeechEngine('stt', {
    audioModel: '',
    sttModel: 'provider-stt',
    textToSpeechMode: 'auto',
    speechToTextMode: 'model',
  }, {
    localTtsAvailable: true,
    localSttAvailable: true,
    modelTtsAvailable: false,
    modelSttAvailable: true,
  })

  assert.deepEqual(resolution, {
    available: true,
    engine: 'model',
    reason: 'model-fallback',
  })
})

test('shouldFallbackToModelAfterLocalFailure only falls back in auto mode with a configured stt model', () => {
  assert.equal(shouldFallbackToModelAfterLocalFailure({
    audioModel: '',
    sttModel: 'provider-stt',
    textToSpeechMode: 'auto',
    speechToTextMode: 'auto',
  }), true)

  assert.equal(shouldFallbackToModelAfterLocalFailure({
    audioModel: '',
    sttModel: '',
    textToSpeechMode: 'auto',
    speechToTextMode: 'auto',
  }), false)

  assert.equal(shouldFallbackToModelAfterLocalFailure({
    audioModel: '',
    sttModel: 'provider-stt',
    textToSpeechMode: 'auto',
    speechToTextMode: 'local',
  }), false)
})
