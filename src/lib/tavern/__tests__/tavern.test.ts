/**
 * Tavern 模块测试
 * 
 * 由于项目没有配置测试框架，这里使用简单的断言函数
 * 可以通过 `npx ts-node src/lib/tavern/__tests__/tavern.test.ts` 运行
 * 或者在添加 vitest/jest 后迁移
 */

// ============ 简单测试工具 ============

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

const results: TestResult[] = []

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn()
    if (result instanceof Promise) {
      result
        .then(() => {
          results.push({ name, passed: true })
          console.log(`✓ ${name}`)
        })
        .catch((e) => {
          results.push({ name, passed: false, error: String(e) })
          console.log(`✗ ${name}: ${e}`)
        })
    } else {
      results.push({ name, passed: true })
      console.log(`✓ ${name}`)
    }
  } catch (e) {
    results.push({ name, passed: false, error: String(e) })
    console.log(`✗ ${name}: ${e}`)
  }
}

function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`)
      }
    },
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
      }
    },
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`)
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy value, got ${actual}`)
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy value, got ${actual}`)
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`)
      }
    },
    toHaveLength(expected: number) {
      if (!Array.isArray(actual) || actual.length !== expected) {
        throw new Error(`Expected length ${expected}, got ${Array.isArray(actual) ? actual.length : 'not an array'}`)
      }
    },
  }
}

// ============ 测试导入 ============

// 注意：这些测试是为了验证逻辑，在实际运行时需要 mock 数据库调用
// 这里主要测试纯函数逻辑

// Template Engine 测试
import { TavernTemplateEngine, processTemplate, parseExampleDialogue, TemplateContext } from '../template-engine'

// Preset Manager 测试
import { detectPresetType, validateContextPreset, BUILTIN_CONTEXT_TEMPLATES } from '../preset-manager'

// Regex Processor 测试
import { RegexPlacement, BuiltInRegex } from '../regex-processor'

// Context Builder 测试
import { estimateTokens } from '../context-builder-v2'

// ============ Template Engine 测试 ============

console.log('\n=== Template Engine Tests ===\n')

test('TavernTemplateEngine - 基本宏替换', () => {
  const engine = new TavernTemplateEngine({
    char: 'Alice',
    user: 'Bob',
  })
  const result = engine.process('Hello, {{char}}! I am {{user}}.')
  expect(result).toBe('Hello, Alice! I am Bob.')
})

test('TavernTemplateEngine - 动态时间宏', () => {
  const engine = new TavernTemplateEngine()
  const result = engine.process('Current time: {{time}}')
  expect(result).toContain(':') // 时间格式应包含冒号
})

test('TavernTemplateEngine - 随机选择宏', () => {
  const engine = new TavernTemplateEngine()
  const options = ['a', 'b', 'c']
  const result = engine.process('{{random: a, b, c}}')
  expect(options.includes(result)).toBeTruthy()
})

test('TavernTemplateEngine - 骰子宏', () => {
  const engine = new TavernTemplateEngine()
  const result = engine.process('{{roll:1d6}}')
  const num = parseInt(result)
  expect(num >= 1 && num <= 6).toBeTruthy()
})

test('TavernTemplateEngine - 条件宏 (存在)', () => {
  const engine = new TavernTemplateEngine({
    char: 'Alice',
    scenario: 'A dark forest',
  })
  const result = engine.process('{{#if scenario}}Scene: {{scenario}}{{/if}}')
  expect(result).toContain('A dark forest')
})

test('TavernTemplateEngine - 条件宏 (不存在)', () => {
  const engine = new TavernTemplateEngine({
    char: 'Alice',
  })
  const result = engine.process('{{#if scenario}}Scene: {{scenario}}{{/if}}')
  expect(result).toBe('')
})

test('processTemplate - 快速处理函数', () => {
  const result = processTemplate('Hello {{char}}!', { char: 'World' })
  expect(result).toBe('Hello World!')
})

test('parseExampleDialogue - 解析对话示例', () => {
  const mesExample = `<START>
{{user}}: Hello there!
{{char}}: Hi! How can I help you?
<START>
{{user}}: Tell me a joke
{{char}}: Why did the chicken cross the road?`

  const messages = parseExampleDialogue(mesExample, 'Assistant', 'User')
  expect(messages).toHaveLength(4)
  expect(messages[0].role).toBe('user')
  expect(messages[1].role).toBe('assistant')
})

// ============ Preset Manager 测试 ============

console.log('\n=== Preset Manager Tests ===\n')

test('detectPresetType - Context 预设', () => {
  const data = { story_string: 'test template' }
  expect(detectPresetType(data)).toBe('context')
})

test('detectPresetType - 未知格式', () => {
  const data = { unknown: 'field' }
  expect(detectPresetType(data)).toBe(null)
})

test('validateContextPreset - 有效预设', () => {
  const preset = { story_string: 'test' }
  expect(validateContextPreset(preset)).toBeTruthy()
})

test('validateContextPreset - 无效预设', () => {
  const preset = { other: 'field' }
  expect(validateContextPreset(preset)).toBeFalsy()
})

test('BUILTIN_CONTEXT_TEMPLATES - 包含标准模板', () => {
  expect(BUILTIN_CONTEXT_TEMPLATES.standard).toBeTruthy()
  expect(BUILTIN_CONTEXT_TEMPLATES.standard.name).toBe('Standard')
})

// ============ Regex Processor 测试 ============

console.log('\n=== Regex Processor Tests ===\n')

// 注意: RegexProcessor 需要数据库访问来加载脚本，这里只测试内置函数

test('RegexPlacement 枚举值', () => {
  expect(RegexPlacement.AI_OUTPUT as string).toBe('AI_OUTPUT')
  expect(RegexPlacement.USER_INPUT as string).toBe('USER_INPUT')
  expect(RegexPlacement.PROMPT as string).toBe('PROMPT')
})

test('BuiltInRegex.removeOOC - 移除 OOC 内容', () => {
  const input = 'Hello (OOC: this is out of character) world'
  const result = BuiltInRegex.removeOOC(input)
  expect(result).toContain('Hello')
  expect(result).toContain('world')
  expect(result.includes('OOC')).toBeFalsy()
})

test('BuiltInRegex.normalizeWhitespace - 规范化空白', () => {
  const input = 'Hello    world\n\n\ntest'
  const result = BuiltInRegex.normalizeWhitespace(input)
  expect(result).toBe('Hello world\n\ntest')
})

// ============ Context Builder 测试 ============

console.log('\n=== Context Builder Tests ===\n')

test('estimateTokens - 空字符串', () => {
  expect(estimateTokens('')).toBe(0)
})

test('estimateTokens - 英文文本', () => {
  const tokens = estimateTokens('Hello world, this is a test.')
  expect(tokens).toBeGreaterThan(0)
})

test('estimateTokens - 中文文本', () => {
  const tokens = estimateTokens('你好世界，这是一个测试。')
  expect(tokens).toBeGreaterThan(0)
})

test('estimateTokens - 混合文本', () => {
  const tokens = estimateTokens('Hello 你好 world 世界')
  expect(tokens).toBeGreaterThan(0)
})

// ============ 测试结果汇总 ============

// 等待异步测试完成
setTimeout(() => {
  console.log('\n=== Test Results ===\n')
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total: ${results.length}`)
  
  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - ${r.name}: ${r.error}`)
    })
  }
}, 1000)
