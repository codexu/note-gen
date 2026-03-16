import assert from 'node:assert/strict'
import test from 'node:test'

const { getSpeechCapabilities } = await import(new URL('../src/lib/speech/capabilities.ts', import.meta.url).href)

test('getSpeechCapabilities reports local speech support from browser APIs', () => {
  const previousWindow = globalThis.window

  globalThis.window = {
    speechSynthesis: {},
    SpeechRecognition: class {},
  } as typeof window

  const capabilities = getSpeechCapabilities({
    audioModel: '',
    sttModel: '',
  })

  assert.deepEqual(capabilities, {
    localTtsAvailable: true,
    localSttAvailable: true,
    modelTtsAvailable: false,
    modelSttAvailable: false,
  })

  globalThis.window = previousWindow
})

test('getSpeechCapabilities reports model availability from configured ids', () => {
  const previousWindow = globalThis.window

  globalThis.window = {} as typeof window

  const capabilities = getSpeechCapabilities({
    audioModel: 'provider-tts',
    sttModel: 'provider-stt',
  })

  assert.deepEqual(capabilities, {
    localTtsAvailable: false,
    localSttAvailable: false,
    modelTtsAvailable: true,
    modelSttAvailable: true,
  })

  globalThis.window = previousWindow
})
