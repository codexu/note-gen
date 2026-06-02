import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const configSource = readFileSync(resolve(__dirname, 'config.tsx'), 'utf-8')

test('baseAiConfig includes MiniMax provider entry', () => {
  assert.ok(configSource.includes("key: 'minimax'"), 'config should have minimax key')
  assert.ok(configSource.includes("title: 'MiniMax'"), 'config should have MiniMax title')
})

test('MiniMax provider uses correct base URL', () => {
  assert.ok(
    configSource.includes("baseURL: 'https://api.minimax.io/v1'"),
    'MiniMax baseURL should be https://api.minimax.io/v1'
  )
})

test('MiniMax provider has apiKeyUrl pointing to platform', () => {
  assert.ok(
    configSource.includes("apiKeyUrl: 'https://platform.minimaxi.com/'"),
    'MiniMax apiKeyUrl should point to platform.minimaxi.com'
  )
})

test('MiniMax provider has an icon URL', () => {
  // Extract the MiniMax block from the config
  const minimaxIdx = configSource.indexOf("key: 'minimax'")
  assert.ok(minimaxIdx > -1, 'MiniMax entry should exist in config')
  const blockEnd = configSource.indexOf('},', minimaxIdx)
  const minimaxBlock = configSource.substring(minimaxIdx, blockEnd)
  assert.ok(minimaxBlock.includes('icon:'), 'MiniMax entry should have an icon')
})

test('MiniMax appears after existing providers (Gitee AI)', () => {
  const giteeIdx = configSource.indexOf("key: 'gitee'")
  const minimaxIdx = configSource.indexOf("key: 'minimax'")
  assert.ok(giteeIdx > -1, 'Gitee AI entry should exist')
  assert.ok(minimaxIdx > -1, 'MiniMax entry should exist')
  assert.ok(minimaxIdx > giteeIdx, 'MiniMax should appear after Gitee AI in the config array')
})

test('all provider entries in baseAiConfig have required fields', () => {
  // Extract all key entries
  const keyPattern = /key:\s*'([^']+)'/g
  const keys = []
  let match
  while ((match = keyPattern.exec(configSource)) !== null) {
    keys.push(match[1])
  }
  assert.ok(keys.includes('minimax'), 'MiniMax should be in the provider keys')
  assert.ok(keys.includes('chatgpt'), 'ChatGPT should be in the provider keys')
  assert.ok(keys.includes('deepseek'), 'DeepSeek should be in the provider keys')

  // Verify MiniMax block has all required fields
  const minimaxIdx = configSource.indexOf("key: 'minimax'")
  const blockStart = configSource.lastIndexOf('{', minimaxIdx)
  const blockEnd = configSource.indexOf('},', minimaxIdx)
  const minimaxBlock = configSource.substring(blockStart, blockEnd + 1)

  assert.ok(minimaxBlock.includes('key:'), 'MiniMax should have key field')
  assert.ok(minimaxBlock.includes('title:'), 'MiniMax should have title field')
  assert.ok(minimaxBlock.includes('baseURL:'), 'MiniMax should have baseURL field')
  assert.ok(minimaxBlock.includes('icon:'), 'MiniMax should have icon field')
  assert.ok(minimaxBlock.includes('apiKeyUrl:'), 'MiniMax should have apiKeyUrl field')
  assert.ok(minimaxBlock.includes('models:'), 'MiniMax should have models field')
})

test('MiniMax has MiniMax-M3 set as default (first in models list)', () => {
  const minimaxIdx = configSource.indexOf("key: 'minimax'")
  const blockStart = configSource.lastIndexOf('{', minimaxIdx)
  // Match the MiniMax block by finding the matching closing brace
  let depth = 0
  let blockEnd = -1
  for (let i = blockStart; i < configSource.length; i++) {
    if (configSource[i] === '{') depth++
    else if (configSource[i] === '}') {
      depth--
      if (depth === 0) { blockEnd = i; break }
    }
  }
  const minimaxBlock = configSource.substring(blockStart, blockEnd + 1)

  // Verify models list contains M3, M2.7, M2.7-highspeed
  assert.ok(minimaxBlock.includes("'MiniMax-M3'"), 'M3 should be in models list')
  assert.ok(minimaxBlock.includes("'MiniMax-M2.7'"), 'M2.7 should be in models list')
  assert.ok(minimaxBlock.includes("'MiniMax-M2.7-highspeed'"), 'M2.7-highspeed should be in models list')

  // Verify M3 is the first model (default)
  const m3Idx = minimaxBlock.indexOf("'MiniMax-M3'")
  const m27Idx = minimaxBlock.indexOf("'MiniMax-M2.7'")
  assert.ok(m3Idx > -1, 'M3 should exist in MiniMax block')
  assert.ok(m27Idx > -1, 'M2.7 should exist in MiniMax block')
  assert.ok(m3Idx < m27Idx, 'M3 should appear before M2.7 (M3 is default)')

  // Verify M2.5 is NOT present
  assert.ok(!minimaxBlock.includes("'MiniMax-M2.5'"), 'M2.5 should be removed')
  assert.ok(!minimaxBlock.includes("'MiniMax-M2.1'"), 'M2.1 should be removed')
  assert.ok(!minimaxBlock.includes("'MiniMax-M2'"), 'M2 should be removed')
  assert.ok(!minimaxBlock.includes("'MiniMax-M1'"), 'M1 should be removed')
})
