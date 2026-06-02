import test from 'node:test'
import assert from 'node:assert/strict'

const API_KEY = process.env.MINIMAX_API_KEY
const BASE_URL = 'https://api.minimax.io/v1'

// Skip all integration tests if no API key is set
const skipReason = API_KEY ? undefined : 'MINIMAX_API_KEY not set'

test('MiniMax M3 chat completion (default model, non-streaming)', { skip: skipReason, timeout: 30000 }, async () => {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'Say "test passed" and nothing else.' }],
      max_tokens: 20,
      temperature: 0.7,
    }),
  })

  assert.equal(response.ok, true, `HTTP ${response.status}: ${response.statusText}`)
  const data = await response.json()
  assert.ok(data.choices, 'response should have choices')
  assert.ok(data.choices.length > 0, 'choices should not be empty')
  assert.ok(data.choices[0].message.content, 'message content should not be empty')
})

test('MiniMax M3 chat completion (streaming)', { skip: skipReason, timeout: 30000 }, async () => {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'Count 1 to 3.' }],
      max_tokens: 50,
      stream: true,
      temperature: 0.7,
    }),
  })

  assert.equal(response.ok, true, `HTTP ${response.status}: ${response.statusText}`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let chunks = 0
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data:') && !line.includes('[DONE]')) {
        chunks++
      }
    }
  }

  assert.ok(chunks > 1, `expected multiple SSE chunks, got ${chunks}`)
})

test('MiniMax M2.7 still works (retained)', { skip: skipReason, timeout: 30000 }, async () => {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      messages: [{ role: 'user', content: 'Say "ok"' }],
      max_tokens: 10,
      temperature: 0.7,
    }),
  })

  assert.equal(response.ok, true, 'M2.7 model should still be accessible')
  const data = await response.json()
  assert.ok(data.choices[0].message.content, 'M2.7 should return content')
})

test('MiniMax M2.7-highspeed still works (retained)', { skip: skipReason, timeout: 30000 }, async () => {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7-highspeed',
      messages: [{ role: 'user', content: 'Say "highspeed ok"' }],
      max_tokens: 20,
      temperature: 0.7,
    }),
  })

  assert.equal(response.ok, true, 'M2.7-highspeed model should still be accessible')
  const data = await response.json()
  assert.ok(data.choices[0].message.content, 'M2.7-highspeed should return content')
})

test('MiniMax handles temperature edge cases', { skip: skipReason, timeout: 30000 }, async () => {
  // Temperature=0 should still produce a valid response
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'Say "ok"' }],
      max_tokens: 10,
      temperature: 0,
    }),
  })

  assert.equal(response.ok, true, 'temperature=0 should be accepted')
  const data = await response.json()
  assert.ok(data.choices[0].message.content, 'should return content with temperature=0')
})
