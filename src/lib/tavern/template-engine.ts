import { TavernCard, TavernPersona, getMacros, TavernMacro } from '@/db/tavern'

/**
 * 模板引擎上下文
 */
export interface TemplateContext {
  char?: string              // 角色名
  user?: string              // 用户名
  scenario?: string          // 场景描述
  personality?: string       // 性格描述
  description?: string       // 角色描述
  mesExamples?: string       // 对话示例
  // 动态宏
  time?: string              // 当前时间
  date?: string              // 当前日期
  weekday?: string           // 星期几
  idle_duration?: string     // 空闲时长
  // 自定义宏
  customMacros?: Record<string, string>
}

/**
 * 随机选择器正则
 * 匹配 {{random: option1, option2, option3}} 或 {{random::option1::option2}}
 */
const RANDOM_MACRO_REGEX = /\{\{random(?:::|:)\s*([^}]+)\}\}/gi

/**
 * 骰子正则
 * 匹配 {{roll:NdM}} 或 {{roll:N}}
 */
const ROLL_MACRO_REGEX = /\{\{roll(?:::|:)\s*(\d+)?(?:d(\d+))?\}\}/gi

/**
 * 标准宏正则
 * 匹配 {{macroName}} 格式
 */
const STANDARD_MACRO_REGEX = /\{\{(\w+)\}\}/g

/**
 * 条件宏正则
 * 匹配 {{#if condition}}...{{/if}} 格式
 */
const CONDITIONAL_REGEX = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/gi

/**
 * 获取当前时间字符串
 */
function getCurrentTime(): string {
  const now = new Date()
  return now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 获取当前日期字符串
 */
function getCurrentDate(): string {
  const now = new Date()
  return now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * 获取星期几
 */
function getWeekday(): string {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return weekdays[new Date().getDay()]
}

/**
 * 处理随机选择宏
 */
function processRandomMacro(text: string): string {
  return text.replace(RANDOM_MACRO_REGEX, (_, options: string) => {
    // 支持 :: 或 , 作为分隔符
    const delimiter = options.includes('::') ? '::' : ','
    const choices = options.split(delimiter).map((s: string) => s.trim()).filter((s: string) => s)
    if (choices.length === 0) return ''
    return choices[Math.floor(Math.random() * choices.length)]
  })
}

/**
 * 处理骰子宏
 */
function processRollMacro(text: string): string {
  return text.replace(ROLL_MACRO_REGEX, (_, count: string, sides: string) => {
    const numDice = parseInt(count) || 1
    const numSides = parseInt(sides) || 6
    let total = 0
    for (let i = 0; i < numDice; i++) {
      total += Math.floor(Math.random() * numSides) + 1
    }
    return String(total)
  })
}

/**
 * 处理条件宏
 */
function processConditionalMacro(text: string, context: TemplateContext): string {
  return text.replace(CONDITIONAL_REGEX, (_, condition: string, content: string) => {
    const value = context[condition as keyof TemplateContext]
    // 如果条件值存在且非空，则保留内容
    if (value && String(value).trim()) {
      return content
    }
    return ''
  })
}

/**
 * TavernTemplateEngine - ST 风格的模板引擎
 * 
 * 支持的宏:
 * - {{char}} - 角色名
 * - {{user}} - 用户名
 * - {{scenario}} - 场景描述
 * - {{personality}} - 性格描述
 * - {{description}} - 角色描述
 * - {{time}} - 当前时间
 * - {{date}} - 当前日期
 * - {{weekday}} - 星期几
 * - {{random: a, b, c}} - 随机选择
 * - {{roll:2d6}} - 骰子
 * - {{#if condition}}...{{/if}} - 条件渲染
 */
export class TavernTemplateEngine {
  private context: TemplateContext
  private customMacros: Map<string, string> = new Map()

  constructor(context: TemplateContext = {}) {
    this.context = context
  }

  /**
   * 从角色卡和用户设定创建上下文
   */
  static fromCardAndPersona(card: TavernCard, persona: TavernPersona): TavernTemplateEngine {
    return new TavernTemplateEngine({
      char: card.name,
      user: persona.name,
      scenario: card.scenario,
      personality: card.personality,
      description: card.description,
      mesExamples: card.mesExample,
    })
  }

  /**
   * 加载数据库中的自定义宏
   */
  async loadCustomMacros(): Promise<void> {
    try {
      const macros = await getMacros()
      for (const macro of macros) {
        if (macro.value) {
          this.customMacros.set(macro.name, macro.value)
        }
      }
    } catch (e) {
      console.warn('加载自定义宏失败:', e)
    }
  }

  /**
   * 设置单个宏值
   */
  setMacro(name: string, value: string): void {
    this.customMacros.set(name, value)
  }

  /**
   * 更新上下文
   */
  updateContext(updates: Partial<TemplateContext>): void {
    this.context = { ...this.context, ...updates }
  }

  /**
   * 处理模板字符串
   */
  process(template: string): string {
    if (!template) return ''

    let result = template

    // 1. 处理条件宏
    result = processConditionalMacro(result, this.context)

    // 2. 处理随机选择宏
    result = processRandomMacro(result)

    // 3. 处理骰子宏
    result = processRollMacro(result)

    // 4. 处理标准宏
    result = result.replace(STANDARD_MACRO_REGEX, (match, macroName: string) => {
      const lowerName = macroName.toLowerCase()

      // 优先查找自定义宏
      if (this.customMacros.has(lowerName)) {
        return this.customMacros.get(lowerName)!
      }

      // 内置动态宏
      switch (lowerName) {
        case 'time':
          return getCurrentTime()
        case 'date':
          return getCurrentDate()
        case 'weekday':
          return getWeekday()
        case 'char':
          return this.context.char || '角色'
        case 'user':
          return this.context.user || '用户'
        case 'scenario':
          return this.context.scenario || ''
        case 'personality':
          return this.context.personality || ''
        case 'description':
          return this.context.description || ''
        case 'mesexamples':
        case 'mes_examples':
          return this.context.mesExamples || ''
        default:
          // 检查上下文中是否有该字段
          const contextValue = this.context[lowerName as keyof TemplateContext]
          if (contextValue !== undefined) {
            return String(contextValue)
          }
          // 检查自定义宏
          const customValue = this.context.customMacros?.[lowerName]
          if (customValue !== undefined) {
            return customValue
          }
          // 未找到宏，保留原样
          return match
      }
    })

    return result
  }

  /**
   * 批量处理多个模板
   */
  processMultiple(templates: (string | undefined)[]): string[] {
    return templates.map((t) => this.process(t || ''))
  }

  /**
   * 处理角色卡中的所有模板字段
   */
  processCard(card: TavernCard): {
    description: string
    personality: string
    scenario: string
    firstMes: string
    mesExample: string
    systemPrompt: string
    postHistoryInstructions: string
  } {
    return {
      description: this.process(card.description),
      personality: this.process(card.personality),
      scenario: this.process(card.scenario),
      firstMes: this.process(card.firstMes),
      mesExample: this.process(card.mesExample),
      systemPrompt: this.process(card.systemPrompt),
      postHistoryInstructions: this.process(card.postHistoryInstructions),
    }
  }
}

/**
 * 快速处理模板字符串
 */
export function processTemplate(
  template: string,
  context: TemplateContext
): string {
  const engine = new TavernTemplateEngine(context)
  return engine.process(template)
}

/**
 * 将 ST 格式的对话示例解析为消息数组
 * ST 格式: <START>\n{{user}}: message\n{{char}}: response
 */
export function parseExampleDialogue(
  mesExample: string,
  charName: string,
  userName: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!mesExample) return []

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

  // 按 <START> 分割对话块
  const blocks = mesExample.split(/<START>/i).filter((b) => b.trim())

  for (const block of blocks) {
    // 按换行分割消息
    const lines = block.split('\n').filter((l) => l.trim())

    for (const line of lines) {
      const trimmed = line.trim()

      // 匹配 {{user}}: 或 {{char}}: 或直接的角色名
      const userMatch = trimmed.match(/^\{\{user\}\}:\s*(.+)/i) ||
                        trimmed.match(new RegExp(`^${escapeRegex(userName)}:\\s*(.+)`, 'i'))
      const charMatch = trimmed.match(/^\{\{char\}\}:\s*(.+)/i) ||
                        trimmed.match(new RegExp(`^${escapeRegex(charName)}:\\s*(.+)`, 'i'))

      if (userMatch) {
        messages.push({ role: 'user', content: userMatch[1] })
      } else if (charMatch) {
        messages.push({ role: 'assistant', content: charMatch[1] })
      }
    }
  }

  return messages
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
