import assert from 'node:assert/strict'
import test from 'node:test'

const {
  NO_TRANSCRIPTION_MESSAGE,
  getTranscriptionFallbackMessage,
} = await import(new URL('../src/lib/speech/transcription-fallback.ts', import.meta.url).href)

test('getTranscriptionFallbackMessage returns the english placeholder when no stt model is configured', () => {
  assert.equal(
    getTranscriptionFallbackMessage(''),
    'No transcription. Configure a speech recognition model.',
  )

  assert.equal(NO_TRANSCRIPTION_MESSAGE, 'No transcription. Configure a speech recognition model.')
})

test('getTranscriptionFallbackMessage returns the generic no-content placeholder when a model exists', () => {
  assert.equal(getTranscriptionFallbackMessage('provider-stt'), '')
})
