/**
 * STscript 内置命令注册
 * 包含控制流命令和基础命令
 */

import type { ExecutionContext, ExecutionResult } from './types'
import { VariableManager, VariableValue, evaluateCondition } from './variables'

// ============ 类型定义 ============

/**
 * 命令处理函数
 */
export type CommandHandler = (
  args: Record<string, VariableValue>,
  context: ExecutionContext,
  executor: CommandExecutorInterface
) => Promise<ExecutionResult> | ExecutionResult

/**
 * 命令定义
 */
export interface ScriptCommand {
  /** 命令名称 */
  name: string
  /** 命令别名 */
  aliases?: string[]
  /** 命令描述 */
  description: string
  /** 是否为控制流命令 */
  isControlFlow?: boolean
  /** 命令处理函数 */
  handler: CommandHandler
  /** 参数定义 */
  params?: CommandParam[]
}

/**
 * 命令参数定义
 */
export interface CommandParam {
  name: string
  description: string
  required?: boolean
  defaultValue?: VariableValue
}

/**
 * 执行器接口 (用于避免循环依赖)
 */
export interface CommandExecutorInterface {
  executeBlock(statements: unknown[]): Promise<ExecutionResult>
  variables: VariableManager
  context: ExecutionContext
  pipeValue?: VariableValue
}

// ============ 命令注册表 ============

const commandRegistry = new Map<string, ScriptCommand>()

/**
 * 注册命令
 */
export function registerCommand(command: ScriptCommand): void {
  commandRegistry.set(command.name, command)
  
  // 注册别名
  if (command.aliases) {
    for (const alias of command.aliases) {
      commandRegistry.set(alias, command)
    }
  }
}

/**
 * 获取命令
 */
export function getCommand(name: string): ScriptCommand | undefined {
  return commandRegistry.get(name)
}

/**
 * 获取所有命令
 */
export function getAllCommands(): ScriptCommand[] {
  // 去重 (因为别名也注册了)
  const seen = new Set<string>()
  const commands: ScriptCommand[] = []
  
  for (const cmd of commandRegistry.values()) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name)
      commands.push(cmd)
    }
  }
  
  return commands
}

// ============ 控制流命令 ============

/**
 * /if 条件判断
 */
registerCommand({
  name: 'if',
  description: '条件判断',
  isControlFlow: true,
  params: [
    { name: 'left', description: '左操作数', required: true },
    { name: 'op', description: '比较运算符', required: true },
    { name: 'right', description: '右操作数', required: true },
  ],
  handler: async (args, context, executor) => {
    const left = args.left
    const right = args.right
    const op = String(args.op || '==')
    
    const result = evaluateCondition(left, op, right)
    
    return {
      success: true,
      output: String(result),
      value: result,
    }
  },
})

/**
 * /else 否则分支
 */
registerCommand({
  name: 'else',
  description: '条件判断的否则分支',
  isControlFlow: true,
  handler: () => {
    // else 命令本身不执行任何操作，由执行器处理
    return { success: true }
  },
})

/**
 * /while 循环
 */
registerCommand({
  name: 'while',
  description: '条件循环',
  isControlFlow: true,
  params: [
    { name: 'left', description: '左操作数', required: true },
    { name: 'op', description: '比较运算符', required: true },
    { name: 'right', description: '右操作数', required: true },
  ],
  handler: async (args) => {
    const left = args.left
    const right = args.right
    const op = String(args.op || '==')
    
    const result = evaluateCondition(left, op, right)
    
    return {
      success: true,
      output: String(result),
      value: result,
    }
  },
})

/**
 * /break 跳出循环
 */
registerCommand({
  name: 'break',
  description: '跳出当前循环',
  isControlFlow: true,
  handler: () => {
    return { success: true, shouldBreak: true }
  },
})

/**
 * /continue 继续下一次循环
 */
registerCommand({
  name: 'continue',
  aliases: ['next'],
  description: '继续下一次循环迭代',
  isControlFlow: true,
  handler: () => {
    return { success: true, shouldContinue: true }
  },
})

/**
 * /return 返回值
 */
registerCommand({
  name: 'return',
  description: '返回值并结束脚本执行',
  isControlFlow: true,
  params: [
    { name: 'value', description: '返回值' },
  ],
  handler: (args, context, executor) => {
    const value = args.value ?? executor.pipeValue ?? ''
    return { success: true, value, shouldReturn: true }
  },
})

// ============ 变量命令 ============

/**
 * /setvar 设置变量
 */
registerCommand({
  name: 'setvar',
  aliases: ['set'],
  description: '设置变量值',
  params: [
    { name: 'key', description: '变量名', required: true },
    { name: 'value', description: '变量值' },
  ],
  handler: (args, context, executor) => {
    const key = String(args.key || '')
    const value = args.value ?? executor.pipeValue ?? ''
    
    if (!key) {
      return { success: false, error: '变量名不能为空' }
    }
    
    executor.variables.set(key, value)
    return { success: true, output: String(value), value }
  },
})

/**
 * /getvar 获取变量
 */
registerCommand({
  name: 'getvar',
  aliases: ['get'],
  description: '获取变量值',
  params: [
    { name: 'key', description: '变量名', required: true },
  ],
  handler: (args, context, executor) => {
    const key = String(args.key || '')
    
    if (!key) {
      return { success: false, error: '变量名不能为空' }
    }
    
    const value = executor.variables.get(key)
    return { success: true, output: String(value ?? ''), value }
  },
})

/**
 * /addvar 增加变量值
 */
registerCommand({
  name: 'addvar',
  aliases: ['incr'],
  description: '增加变量的数值',
  params: [
    { name: 'key', description: '变量名', required: true },
    { name: 'value', description: '增加量', defaultValue: 1 },
  ],
  handler: (args, context, executor) => {
    const key = String(args.key || '')
    const amount = Number(args.value ?? executor.pipeValue ?? 1)
    
    if (!key) {
      return { success: false, error: '变量名不能为空' }
    }
    
    const newValue = executor.variables.increment(key, amount)
    return { success: true, output: String(newValue), value: newValue }
  },
})

/**
 * /subvar 减少变量值
 */
registerCommand({
  name: 'subvar',
  aliases: ['decr'],
  description: '减少变量的数值',
  params: [
    { name: 'key', description: '变量名', required: true },
    { name: 'value', description: '减少量', defaultValue: 1 },
  ],
  handler: (args, context, executor) => {
    const key = String(args.key || '')
    const amount = Number(args.value ?? executor.pipeValue ?? 1)
    
    if (!key) {
      return { success: false, error: '变量名不能为空' }
    }
    
    const newValue = executor.variables.decrement(key, amount)
    return { success: true, output: String(newValue), value: newValue }
  },
})

/**
 * /let 声明局部变量
 */
registerCommand({
  name: 'let',
  description: '声明局部变量',
  params: [
    { name: 'key', description: '变量名', required: true },
    { name: 'value', description: '初始值' },
  ],
  handler: (args, context, executor) => {
    const key = String(args.key || '')
    const value = args.value ?? executor.pipeValue ?? ''
    
    if (!key) {
      return { success: false, error: '变量名不能为空' }
    }
    
    // 直接在当前作用域创建
    executor.variables.set(`local.${key}`, value)
    return { success: true, output: String(value), value }
  },
})

// ============ 输出命令 ============

/**
 * /echo 输出文本
 */
registerCommand({
  name: 'echo',
  aliases: ['print'],
  description: '输出文本',
  params: [
    { name: 'text', description: '要输出的文本' },
  ],
  handler: (args, context, executor) => {
    const text = String(args.text ?? executor.pipeValue ?? '')
    return { success: true, output: text, value: text }
  },
})

/**
 * /comment 注释 (不执行任何操作)
 */
registerCommand({
  name: 'comment',
  aliases: ['//'],
  description: '注释，不执行任何操作',
  handler: () => {
    return { success: true }
  },
})

// ============ 数学命令 ============

/**
 * /add 加法
 */
registerCommand({
  name: 'add',
  description: '加法运算',
  params: [
    { name: 'a', description: '第一个数', required: true },
    { name: 'b', description: '第二个数' },
  ],
  handler: (args, context, executor) => {
    const a = Number(args.a)
    const b = Number(args.b ?? executor.pipeValue ?? 0)
    const result = a + b
    return { success: true, output: String(result), value: result }
  },
})

/**
 * /sub 减法
 */
registerCommand({
  name: 'sub',
  description: '减法运算',
  params: [
    { name: 'a', description: '被减数', required: true },
    { name: 'b', description: '减数' },
  ],
  handler: (args, context, executor) => {
    const a = Number(args.a)
    const b = Number(args.b ?? executor.pipeValue ?? 0)
    const result = a - b
    return { success: true, output: String(result), value: result }
  },
})

/**
 * /mul 乘法
 */
registerCommand({
  name: 'mul',
  description: '乘法运算',
  params: [
    { name: 'a', description: '第一个数', required: true },
    { name: 'b', description: '第二个数' },
  ],
  handler: (args, context, executor) => {
    const a = Number(args.a)
    const b = Number(args.b ?? executor.pipeValue ?? 1)
    const result = a * b
    return { success: true, output: String(result), value: result }
  },
})

/**
 * /div 除法
 */
registerCommand({
  name: 'div',
  description: '除法运算',
  params: [
    { name: 'a', description: '被除数', required: true },
    { name: 'b', description: '除数' },
  ],
  handler: (args, context, executor) => {
    const a = Number(args.a)
    const b = Number(args.b ?? executor.pipeValue ?? 1)
    
    if (b === 0) {
      return { success: false, error: '除数不能为零' }
    }
    
    const result = a / b
    return { success: true, output: String(result), value: result }
  },
})

/**
 * /mod 取模
 */
registerCommand({
  name: 'mod',
  description: '取模运算',
  params: [
    { name: 'a', description: '被除数', required: true },
    { name: 'b', description: '除数' },
  ],
  handler: (args, context, executor) => {
    const a = Number(args.a)
    const b = Number(args.b ?? executor.pipeValue ?? 1)
    
    if (b === 0) {
      return { success: false, error: '除数不能为零' }
    }
    
    const result = a % b
    return { success: true, output: String(result), value: result }
  },
})

/**
 * /roll 掷骰子
 */
registerCommand({
  name: 'roll',
  aliases: ['dice'],
  description: '掷骰子',
  params: [
    { name: 'range', description: '范围 (如 d20 或 1-100)', defaultValue: 'd100' },
  ],
  handler: (args) => {
    const range = String(args.range || 'd100')
    let min = 1, max = 100
    
    // 解析 dN 格式
    const diceMatch = range.match(/^d(\d+)$/i)
    if (diceMatch) {
      max = parseInt(diceMatch[1])
    } else {
      // 解析 min-max 格式
      const rangeMatch = range.match(/^(\d+)-(\d+)$/)
      if (rangeMatch) {
        min = parseInt(rangeMatch[1])
        max = parseInt(rangeMatch[2])
      } else {
        // 尝试作为单个数字
        const num = parseInt(range)
        if (!isNaN(num)) {
          max = num
        }
      }
    }
    
    const result = Math.floor(Math.random() * (max - min + 1)) + min
    return { success: true, output: `🎲 ${result}`, value: result }
  },
})

/**
 * /random 随机数
 */
registerCommand({
  name: 'random',
  aliases: ['rand'],
  description: '生成随机数',
  params: [
    { name: 'min', description: '最小值', defaultValue: 0 },
    { name: 'max', description: '最大值', defaultValue: 1 },
  ],
  handler: (args) => {
    const min = Number(args.min ?? 0)
    const max = Number(args.max ?? 1)
    
    // 如果是整数范围，返回整数
    if (Number.isInteger(min) && Number.isInteger(max)) {
      const result = Math.floor(Math.random() * (max - min + 1)) + min
      return { success: true, output: String(result), value: result }
    }
    
    // 否则返回浮点数
    const result = Math.random() * (max - min) + min
    return { success: true, output: String(result), value: result }
  },
})

// ============ 字符串命令 ============

/**
 * /len 字符串长度
 */
registerCommand({
  name: 'len',
  aliases: ['length'],
  description: '获取字符串长度',
  params: [
    { name: 'text', description: '文本' },
  ],
  handler: (args, context, executor) => {
    const text = String(args.text ?? executor.pipeValue ?? '')
    const len = text.length
    return { success: true, output: String(len), value: len }
  },
})

/**
 * /trim 去除空白
 */
registerCommand({
  name: 'trim',
  description: '去除字符串两端空白',
  params: [
    { name: 'text', description: '文本' },
  ],
  handler: (args, context, executor) => {
    const text = String(args.text ?? executor.pipeValue ?? '').trim()
    return { success: true, output: text, value: text }
  },
})

/**
 * /lower 转小写
 */
registerCommand({
  name: 'lower',
  aliases: ['lowercase'],
  description: '转换为小写',
  params: [
    { name: 'text', description: '文本' },
  ],
  handler: (args, context, executor) => {
    const text = String(args.text ?? executor.pipeValue ?? '').toLowerCase()
    return { success: true, output: text, value: text }
  },
})

/**
 * /upper 转大写
 */
registerCommand({
  name: 'upper',
  aliases: ['uppercase'],
  description: '转换为大写',
  params: [
    { name: 'text', description: '文本' },
  ],
  handler: (args, context, executor) => {
    const text = String(args.text ?? executor.pipeValue ?? '').toUpperCase()
    return { success: true, output: text, value: text }
  },
})

/**
 * /substr 截取字符串
 */
registerCommand({
  name: 'substr',
  aliases: ['substring'],
  description: '截取字符串',
  params: [
    { name: 'text', description: '文本' },
    { name: 'start', description: '起始位置', required: true },
    { name: 'end', description: '结束位置' },
  ],
  handler: (args, context, executor) => {
    const text = String(args.text ?? executor.pipeValue ?? '')
    const start = Number(args.start ?? 0)
    const end = args.end !== undefined ? Number(args.end) : undefined
    
    const result = text.substring(start, end)
    return { success: true, output: result, value: result }
  },
})

/**
 * /split 分割字符串
 */
registerCommand({
  name: 'split',
  description: '分割字符串为数组',
  params: [
    { name: 'text', description: '文本' },
    { name: 'sep', description: '分隔符', defaultValue: ',' },
  ],
  handler: (args, context, executor) => {
    const text = String(args.text ?? executor.pipeValue ?? '')
    const sep = String(args.sep ?? ',')
    const parts = text.split(sep)
    const result = JSON.stringify(parts)
    return { success: true, output: result, value: result }
  },
})

/**
 * /join 连接数组
 */
registerCommand({
  name: 'join',
  description: '连接数组为字符串',
  params: [
    { name: 'array', description: '数组' },
    { name: 'sep', description: '分隔符', defaultValue: ',' },
  ],
  handler: (args, context, executor) => {
    let arrayValue = args.array ?? executor.pipeValue ?? '[]'
    const sep = String(args.sep ?? ',')
    
    // 尝试解析 JSON 数组
    let parsedArray: unknown[]
    if (typeof arrayValue === 'string') {
      try {
        const parsed = JSON.parse(arrayValue)
        parsedArray = Array.isArray(parsed) ? parsed : [arrayValue]
      } catch {
        parsedArray = [arrayValue]
      }
    } else {
      parsedArray = [arrayValue]
    }
    
    const result = parsedArray.join(sep)
    return { success: true, output: result, value: result }
  },
})

// ============ 逻辑命令 ============

/**
 * /not 逻辑非
 */
registerCommand({
  name: 'not',
  description: '逻辑非',
  params: [
    { name: 'value', description: '值' },
  ],
  handler: (args, context, executor) => {
    const value = args.value ?? executor.pipeValue
    const result = !value
    return { success: true, output: String(result), value: result }
  },
})

/**
 * /and 逻辑与
 */
registerCommand({
  name: 'and',
  description: '逻辑与',
  params: [
    { name: 'a', description: '第一个值', required: true },
    { name: 'b', description: '第二个值' },
  ],
  handler: (args, context, executor) => {
    const a = args.a
    const b = args.b ?? executor.pipeValue
    const result = !!(a && b)
    return { success: true, output: String(result), value: result }
  },
})

/**
 * /or 逻辑或
 */
registerCommand({
  name: 'or',
  description: '逻辑或',
  params: [
    { name: 'a', description: '第一个值', required: true },
    { name: 'b', description: '第二个值' },
  ],
  handler: (args, context, executor) => {
    const a = args.a
    const b = args.b ?? executor.pipeValue
    const result = !!(a || b)
    return { success: true, output: String(result), value: result }
  },
})

// ============ 时间命令 ============

/**
 * /time 获取当前时间
 */
registerCommand({
  name: 'time',
  aliases: ['now'],
  description: '获取当前时间',
  params: [
    { name: 'format', description: '格式 (iso/unix/date/time)', defaultValue: 'iso' },
  ],
  handler: (args) => {
    const format = String(args.format ?? 'iso')
    const now = new Date()
    
    let result: string | number
    switch (format) {
      case 'unix':
        result = Math.floor(now.getTime() / 1000)
        break
      case 'ms':
        result = now.getTime()
        break
      case 'date':
        result = now.toLocaleDateString()
        break
      case 'time':
        result = now.toLocaleTimeString()
        break
      case 'iso':
      default:
        result = now.toISOString()
        break
    }
    
    return { success: true, output: String(result), value: result }
  },
})

/**
 * /wait 等待
 */
registerCommand({
  name: 'wait',
  aliases: ['sleep', 'delay'],
  description: '等待指定毫秒数',
  params: [
    { name: 'ms', description: '毫秒数', defaultValue: 1000 },
  ],
  handler: async (args) => {
    const ms = Number(args.ms ?? 1000)
    await new Promise(resolve => setTimeout(resolve, ms))
    return { success: true, output: `等待 ${ms}ms` }
  },
})

// ============ 导出 ============

export {
  commandRegistry,
}
