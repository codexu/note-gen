import assert from 'node:assert/strict'
import test from 'node:test'

class FakeRecognition {
  continuous = false
  interimResults = false
  lang = 'zh-CN'
  maxAlternatives = 1
  onerror: ((event: any) => void) | null = null
  onresult: ((event: any) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null

  start() {
    this.onstart?.()
  }

  stop() {
    const result: {
      isFinal: boolean
      length: number
      0: { transcript: string; confidence: number }
      item(index: number): { transcript: string; confidence: number }
    } = {
      isFinal: true,
      0: { transcript: '本地识别成功', confidence: 0.98 },
      length: 1,
      item(index: number) {
        return result[index as 0]
      },
    }

    this.onresult?.({
      resultIndex: 0,
      results: [result],
    })
    this.onend?.()
  }

  abort() {
    this.onend?.()
  }
}

test('stopRecognition returns the final transcript emitted during stop', async () => {
  const previousWindow = globalThis.window

  globalThis.window = {
    SpeechRecognition: FakeRecognition,
  } as typeof window

  const storeModule = await import(new URL('../src/stores/speech-recognition.ts', import.meta.url).href)
  const useSpeechRecognitionStore = storeModule.default

  useSpeechRecognitionStore.getState().resetState()
  await useSpeechRecognitionStore.getState().startRecognition()

  const transcript = await useSpeechRecognitionStore.getState().stopRecognition()

  assert.equal(transcript, '本地识别成功')

  globalThis.window = previousWindow
})

class FailingRecognition {
  continuous = false
  interimResults = false
  lang = 'zh-CN'
  maxAlternatives = 1
  onerror: ((event: any) => void) | null = null
  onresult: ((event: any) => void) | null = null
  onend: (() => void) | null = null
  onstart: (() => void) | null = null

  start() {
    this.onerror?.({ error: 'service-not-allowed' })
  }

  stop() {}

  abort() {
    this.onend?.()
  }
}

test('startRecognition rejects when the browser service denies speech recognition', async () => {
  const previousWindow = globalThis.window

  globalThis.window = {
    SpeechRecognition: FailingRecognition,
  } as typeof window

  const storeModule = await import(new URL('../src/stores/speech-recognition.ts', import.meta.url).href + `?failing=${Date.now()}`)
  const useSpeechRecognitionStore = storeModule.default

  useSpeechRecognitionStore.getState().resetState()

  await assert.rejects(
    () => useSpeechRecognitionStore.getState().startRecognition(),
    /service-not-allowed/,
  )

  assert.equal(useSpeechRecognitionStore.getState().lastError, 'service-not-allowed')

  globalThis.window = previousWindow
})
