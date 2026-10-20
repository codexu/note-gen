import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadMiniMaxRuntime } from '../../../lib/ai/minimax-test-runtime.mjs'

const state = { store: new Map(), errors: [], toolCalls: [] }
const runtime = await loadMiniMaxRuntime(state)
const current = ['MiniMax-M3.1-Flash', 'MiniMax-M3']

test('bundled global and China templates seed Flash first with native capabilities', () => {
  const templates = runtime.builtinProviderTemplates.filter(item => runtime.getMiniMaxRoute(item.baseURL))
  assert.deepEqual(templates.map(item => item.baseURL), ['https://api.minimax.io/v1', 'https://api.minimax.cn/v1'])
  for (const template of templates) {
    assert.deepEqual(template.models.map(item => item.model), current)
    assert.deepEqual(template.models.map(item => item.contextWindow), [1_000_000, 1_000_000])
    assert.deepEqual(template.models.map(item => item.maxOutputTokens), [524_288, 524_288])
    assert.deepEqual(template.models[0].thinking, ['adaptive'])
    assert.deepEqual(template.models[1].thinking, ['adaptive', 'disabled'])
  }
})

test('both remote manifests and cached templates use the same ordinary catalog', async () => {
  for (const name of ['provider-templates.json', 'provider-templates-cn.json']) {
    const payload = JSON.parse(readFileSync(new URL(`../../../../config/${name}`, import.meta.url)))
    state.remote = { status: 'ok', payload, versionCode: 1 }
    const templates = await runtime.loadProviderTemplates(runtime.builtinProviderTemplates)
    for (const template of templates.filter(item => runtime.getMiniMaxRoute(item.baseURL) === 'direct')) {
      assert.deepEqual(template.models.map(item => item.model), current)
    }
    const cached = await runtime.getCachedProviderTemplates()
    assert.deepEqual(cached.map(item => item.models), templates.map(item => item.models))
  }
})

test('picker filters legacy text only and preserves gateway metadata, media, and other providers', () => {
  const input = [
    { id: 'minimax/minimax-m2.7' }, { id: 'minimax/minimax-01' },
    { id: 'minimax/minimax-m3', context_length: 1048576, pricing: { prompt: '0.0000003' } },
    { id: 'minimax/minimax-m3.1-flash:free', pricing: { prompt: '0' } },
    { id: 'openai/gpt-4.1' }, { id: 'minimax/speech-02' }, { id: 'minimax/hailuo-02' },
  ]
  const choices = runtime.filterMiniMaxChoices(input, 'https://openrouter.ai/api/v1')
  assert.deepEqual(choices.map(item => item.id), ['minimax/minimax-m3.1-flash:free', 'minimax/minimax-m3', 'openai/gpt-4.1', 'minimax/speech-02', 'minimax/hailuo-02'])
  assert.equal(choices[1], input[2])
  assert.deepEqual(runtime.filterMiniMaxChoices([input[0]], 'https://openrouter.ai/api/v1'), [])
  assert.deepEqual(runtime.miniMaxModelChoices('https://openrouter.ai/api/v1'), [])
  for (const url of ['https://custom.example/v1', 'https://api.minimax.io.evil/v1', 'https://api.minimax.io/anthropic', 'https://api.minimax.io/v1?route=other']) {
    assert.equal(runtime.filterMiniMaxChoices(input, url), input)
  }
})

test('saved legacy IDs and custom configurations resolve without migration', async () => {
  const saved = { key: 'saved', title: 'MiniMax', baseURL: 'https://api.minimaxi.com/v1', models: [{ id: 'legacy', model: 'MiniMax-M2.7', modelType: 'chat', temperature: 0.3 }] }
  state.store.set('aiModelList', [saved])
  const before = structuredClone(saved)
  assert.equal((await runtime.getAISettingsByModelId('legacy')).model, 'MiniMax-M2.7')
  assert.deepEqual(saved, before)
  const custom = { ...saved, baseURL: 'https://custom.example/v1' }
  assert.equal(runtime.withMiniMaxModels(custom), custom)
  const media = { id: 'speech', model: 'speech-02', modelType: 'tts' }
  const other = { id: 'other', model: 'custom-chat', modelType: 'chat' }
  assert.deepEqual(runtime.withMiniMaxModels({ ...saved, models: [...saved.models, media, other] }).models.slice(2), [media, other])
})
