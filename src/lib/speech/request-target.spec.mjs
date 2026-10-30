import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSpeechRequestTarget } from './request-target.js'

const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'key', customHeaders: { 'X-Workspace': 'test' }, proxy: { mode: 'direct' } }

test('keeps standard provider requests unchanged', () => {
  for (const path of ['/audio/speech', '/audio/transcriptions']) {
    const result = resolveSpeechRequestTarget(config, '', path)
    assert.equal(result.config, config)
    assert.equal(result.path, path)
  }
})

test('uses full custom speech URLs without appending a standard path', () => {
  const result = resolveSpeechRequestTarget(config, ' https://speech.example.com:9443/custom/transcribe?version=2 ', '/audio/transcriptions')
  assert.deepEqual(result.config, { ...config, baseUrl: 'https://speech.example.com:9443' })
  assert.equal(result.path, '/custom/transcribe?version=2')
  assert.equal(config.baseUrl, 'https://api.example.com/v1')
  assert.equal(resolveSpeechRequestTarget(config, 'http://localhost:8080/tts/', '/audio/speech').path, '/tts/')
})

test('preserves encoded paths and root endpoints', () => {
  assert.equal(resolveSpeechRequestTarget(config, 'https://speech.test/%E8%AF%AD%E9%9F%B3?name=a%20b', '/audio/speech').path, '/%E8%AF%AD%E9%9F%B3?name=a%20b')
  assert.equal(resolveSpeechRequestTarget(config, 'https://speech.test/?version=1', '/audio/speech').path, '/?version=1')
})

test('recognizes full standard endpoints already saved in the provider URL', () => {
  for (const path of ['/audio/speech', '/audio/transcriptions']) {
    const result = resolveSpeechRequestTarget({ ...config, baseUrl: `https://api.siliconflow.cn/v1${path}?version=1` }, undefined, path)
    assert.equal(result.config.baseUrl, 'https://api.siliconflow.cn')
    assert.equal(result.path, `/v1${path}?version=1`)
  }
})

test('rejects invalid URLs and unsupported realtime protocols', () => {
  for (const url of ['not-a-url', 'wss://speech.test/realtime', 'ws://localhost/realtime', 'file:///tmp/audio', 'https://user:password@speech.test/tts', 'https://speech.test/tts#fragment', 'https://speech.test//tts']) {
    assert.throws(() => resolveSpeechRequestTarget(config, url, '/audio/speech'), /Speech endpoint/)
  }
})
