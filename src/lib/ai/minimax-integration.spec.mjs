import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { loadMiniMaxRuntime } from './minimax-test-runtime.mjs'

const requests = []
const state = { store: new Map(), errors: [], toolCalls: [], toolMode: false }
const reasoning = [{ type: 'reasoning.encrypted', data: 'opaque-history', index: 0 }]
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : undefined
  requests.push({ path: req.url, body, headers: req.headers })
  if (!body?.stream) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'answer' } }] }))
    return
  }
  res.setHeader('Content-Type', 'text/event-stream')
  const firstToolRound = state.toolMode && !body.messages.some(message => message.role === 'tool')
  const deltas = firstToolRound ? [
    { reasoning_content: 'inspect ', reasoning_details: reasoning },
    { reasoning_content: 'the note', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'notes__read', arguments: '{"id":' } }] },
    { tool_calls: [{ index: 0, function: { arguments: '1}' } }] },
  ] : [{ content: 'answer' }]
  for (const delta of deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
  res.end('data: [DONE]\n\n')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
after(() => server.close())
const localURL = `http://127.0.0.1:${server.address().port}`
state.invoke = async (command, { request, onEvent }) => {
  assert.ok(['ai_json_request', 'ai_chat_completion_stream'].includes(command))
  state.lastConfig = request.config
  const response = await fetch(localURL + (request.path || '/chat/completions'), {
    method: request.method || 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${request.config.apiKey || 'fixture'}` },
    body: request.body ? JSON.stringify(request.body) : undefined,
  })
  if (!onEvent) return response.json()
  for (const line of (await response.text()).split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
    onEvent.onmessage({ type: 'chunk', data: JSON.parse(line.slice(6)) })
  }
  onEvent.onmessage({ type: 'done' })
}
const runtime = await loadMiniMaxRuntime(state)
const base = { key: 'minimax', title: 'MiniMax', apiKey: 'fixture-only', proxyMode: 'direct' }
const payload = { model: 'MiniMax-M3.1-Flash', messages: [{ role: 'user', content: 'hello' }], max_completion_tokens: 512, temperature: 0.7, top_p: 1, service_tier: 'priority' }

for (const baseURL of ['https://api.minimax.io/v1', 'https://api.minimax.cn/v1', 'https://api.minimaxi.com/v1']) {
  test(`native default, effort, and M3 thinking controls serialize for ${baseURL}`, async () => {
    const client = await runtime.createTauriOpenAIClient({ ...base, baseURL, model: payload.model })
    const result = await client.chat.completions.create(payload)
    assert.equal(result.choices[0].message.content, 'answer')
    assert.equal(state.lastConfig.baseUrl, baseURL)
    assert.deepEqual(requests.at(-1).body, { model: payload.model, messages: payload.messages, max_tokens: 512, thinking: { type: 'adaptive' }, reasoning_effort: 'max' })
    for (const reasoningEffort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const configured = await runtime.createTauriOpenAIClient({ ...base, baseURL, model: payload.model, reasoningEffort })
      await configured.chat.completions.create(payload)
      assert.equal(requests.at(-1).body.reasoning_effort, reasoningEffort)
    }
    for (const reasoningEffort of ['none', 'minimal']) {
      const configured = await runtime.createTauriOpenAIClient({ ...base, baseURL, model: payload.model, reasoningEffort })
      await assert.rejects(configured.chat.completions.create(payload), /requires adaptive thinking/)
    }
    await assert.rejects(client.chat.completions.create({ ...payload, thinking: { type: 'disabled' } }), /requires adaptive thinking/)
    await assert.rejects(client.chat.completions.create({ ...payload, reasoning_split: false }), /separate reasoning/)
    for (const reasoningEffort of [undefined, 'none', 'high']) {
      const m3 = await runtime.createTauriOpenAIClient({ ...base, baseURL, model: 'MiniMax-M3', reasoningEffort })
      await m3.chat.completions.create({ ...payload, model: 'MiniMax-M3' })
      assert.deepEqual(requests.at(-1).body.thinking, { type: reasoningEffort === 'none' ? 'disabled' : 'adaptive' })
      assert.equal(requests.at(-1).body.reasoning_effort, undefined)
    }
  })
}

test('actual default settings → chat → HTTP preserves images, video, tool calls and reasoning history', async () => {
  const template = runtime.builtinProviderTemplates.find(item => item.key === 'minimax-global')
  state.store.set('aiModelList', [{ ...template, apiKey: 'fixture-only', proxyMode: 'direct' }])
  state.store.set('primaryModel', template.models[0].id)
  const image = 'data:image/png;base64,AQID'
  const video = { type: 'video_url', video_url: { url: 'https://example.invalid/video.mp4' } }
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'read this' }, { type: 'image_url', image_url: { url: image } }, video] }]
  assert.equal(await runtime.fetchAi('ignored', undefined, messages), 'answer')
  assert.deepEqual(requests.at(-1).body.messages, messages)
  state.toolMode = true
  const start = requests.length
  const updates = []
  await runtime.fetchAiStream('read', value => updates.push(value), undefined, [{ type: 'function', function: { name: 'notes__read', parameters: { type: 'object', properties: { id: { type: 'number' } } } } }], undefined, undefined, undefined, undefined, messages)
  state.toolMode = false
  assert.equal(requests.length - start, 2)
  const [first, followup] = requests.slice(start)
  assert.equal(first.body.model, 'MiniMax-M3.1-Flash')
  assert.deepEqual(first.body.messages, messages)
  assert.deepEqual(followup.body.tools, first.body.tools)
  const assistant = followup.body.messages.find(message => message.role === 'assistant')
  assert.equal(assistant.reasoning_content, 'inspect the note')
  assert.deepEqual(assistant.reasoning_details, reasoning)
  assert.equal(assistant.tool_calls[0].function.arguments, '{"id":1}')
  assert.equal(followup.body.messages.at(-1).tool_call_id, 'call-1')
  assert.equal(state.toolCalls.length, 1)
  assert.equal(updates.at(-1), 'answer')
  assert.deepEqual(state.errors, [])
})

test('OpenRouter Flash uses gateway reasoning; saved legacy/custom and non-MiniMax requests are preserved', async () => {
  const client = await runtime.createTauriOpenAIClient({ ...base, baseURL: 'https://openrouter.ai/api/v1', model: 'minimax/minimax-m3.1-flash:free' })
  await client.chat.completions.create({ ...payload, model: 'minimax/minimax-m3.1-flash:free' })
  assert.deepEqual(requests.at(-1).body.reasoning, { enabled: true, effort: 'max' })
  assert.equal(requests.at(-1).body.thinking, undefined)
  assert.equal(requests.at(-1).body.reasoning_effort, undefined)
  for (const [baseURL, model] of [
    ['https://api.minimax.io/v1', 'MiniMax-M2.7'],
    ['https://api.minimax.io/v1', 'speech-02'],
    ['https://custom.example/v1', 'MiniMax-M3.1-Flash'],
    ['https://api.minimax.io/anthropic', 'MiniMax-M3.1-Flash'],
    ['https://api.openai.com/v1', 'gpt-4.1'],
  ]) {
    const saved = await runtime.createTauriOpenAIClient({ ...base, baseURL, model })
    await saved.chat.completions.create({ ...payload, model })
    assert.deepEqual(requests.at(-1).body, { ...payload, model })
  }
})
