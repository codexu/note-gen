/**
 * STscript 脚本执行引擎
 * 执行 AST 并处理管道操作
 */

import {
  NodeType,
  ProgramNode,
  StatementNode,
  CommandStatementNode,
  PipeStatementNode,
  IfStatementNode,
  WhileStatementNode,
  BreakStatementNode,
  ReturnStatementNode,
  BlockNode,
  TextContentNode,
  ExpressionNode,
  LiteralNode,
  IdentifierNode,
  VariableAccessNode,
  BinaryExpressionNode,
  UnaryExpressionNode,
  ArgumentNode,
  ExecutionContext,
  ExecutionResult,
} from './types'
import { parseScript as parseScriptAST } from './parser'
import { VariableManager, VariableValue, createVariableManager, replaceVariables } from './variables'
import { getCommand, CommandExecutorInterface } from './commands'

// ============ 执行器配置 ============

/**
 * 执行器配置
 */
export interface ExecutorConfig {
  /** 最大执行步数 (防止无限循环) */
  maxSteps?: number
  /** 最大递归深度 */
  maxDepth?: number
  /** 命令执行超时 (ms) */
  timeout?: number
  /** 外部命令回调 */
  callbacks?: ExecutorCallbacks
}

/**
 * 外部命令回调
 */
export interface ExecutorCallbacks {
  onSend?: (message: string) => Promise<void>
  onContinue?: () => Promise<void>
  onRegenerate?: () => Promise<void>
  onSwipe?: (direction: 'left' | 'right') => Promise<void>
  onOutput?: (text: string) => void
}

const DEFAULT_CONFIG: Required<ExecutorConfig> = {
  maxSteps: 10000,
  maxDepth: 100,
  timeout: 30000,
  callbacks: {},
}

// ============ 执行器 ============

/**
 * 脚本执行器
 */
export class ScriptExecutor implements CommandExecutorInterface {
  private config: Required<ExecutorConfig>
  private _variables: VariableManager
  private _context: ExecutionContext
  private _pipeValue?: VariableValue
  
  private stepCount: number = 0
  private depth: number = 0
  private aborted: boolean = false
  
  constructor(
    context: ExecutionContext,
    config?: ExecutorConfig
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this._context = context
    this._variables = createVariableManager(context.chatId)
    this._pipeValue = context.pipeValue
  }
  
  // 实现 CommandExecutorInterface
  get variables(): VariableManager {
    return this._variables
  }
  
  get context(): ExecutionContext {
    return this._context
  }
  
  get pipeValue(): VariableValue | undefined {
    return this._pipeValue
  }
  
  /**
   * 执行脚本文本
   */
  async execute(script: string): Promise<ExecutionResult> {
    try {
      const { program, errors } = parseScriptAST(script)
      if (errors.length > 0) {
        return {
          success: false,
          error: `解析错误: ${errors[0].message} (行 ${errors[0].line}, 列 ${errors[0].column})`,
        }
      }
      return await this.executeProgram(program)
    } catch (error) {
      return {
        success: false,
        error: `解析错误: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  
  /**
   * 执行 AST 程序节点
   */
  async executeProgram(program: ProgramNode): Promise<ExecutionResult> {
    this.stepCount = 0
    this.aborted = false
    
    try {
      const result = await this.executeStatements(program.statements)
      return result
    } catch (error) {
      if (error instanceof AbortError) {
        return { success: false, error: error.message }
      }
      return {
        success: false,
        error: `执行错误: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  
  /**
   * 执行语句列表
   */
  private async executeStatements(statements: StatementNode[]): Promise<ExecutionResult> {
    let lastResult: ExecutionResult = { success: true }
    let outputs: string[] = []
    
    for (const statement of statements) {
      if (this.aborted) {
        break
      }
      
      this.checkLimits()
      
      const result = await this.executeStatement(statement)
      lastResult = result
      
      if (result.output) {
        outputs.push(result.output)
      }
      
      // 处理控制流
      if (!result.success || result.shouldBreak || result.shouldReturn) {
        break
      }
    }
    
    return {
      ...lastResult,
      output: outputs.join('\n') || lastResult.output,
    }
  }
  
  /**
   * 执行单个语句
   */
  private async executeStatement(statement: StatementNode): Promise<ExecutionResult> {
    this.stepCount++
    
    switch (statement.type) {
      case NodeType.COMMAND_STATEMENT:
        return this.executeCommand(statement)
        
      case NodeType.PIPE_STATEMENT:
        return this.executePipe(statement)
        
      case NodeType.IF_STATEMENT:
        return this.executeIf(statement)
        
      case NodeType.WHILE_STATEMENT:
        return this.executeWhile(statement)
        
      case NodeType.BREAK_STATEMENT:
        return { success: true, shouldBreak: true }
        
      case NodeType.RETURN_STATEMENT:
        return this.executeReturn(statement)
        
      case NodeType.TEXT_CONTENT:
        return { success: true, output: statement.content, value: statement.content }
        
      default:
        return { success: false, error: `未知语句类型: ${(statement as StatementNode).type}` }
    }
  }
  
  /**
   * 执行命令
   */
  private async executeCommand(node: CommandStatementNode): Promise<ExecutionResult> {
    const commandName = node.command.toLowerCase()
    
    // 获取命令定义
    const command = getCommand(commandName)
    
    if (!command) {
      // 尝试作为外部命令处理
      return this.executeExternalCommand(commandName, node)
    }
    
    // 解析参数
    const args = await this.resolveArguments(node)
    
    // 执行命令
    try {
      const result = await command.handler(args, this._context, this)
      
      // 更新管道值
      if (result.value !== undefined) {
        this._pipeValue = result.value as VariableValue
      }
      
      return result
    } catch (error) {
      return {
        success: false,
        error: `命令 /${commandName} 执行失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  
  /**
   * 执行外部命令 (聊天相关)
   */
  private async executeExternalCommand(name: string, node: CommandStatementNode): Promise<ExecutionResult> {
    const callbacks = this.config.callbacks
    const args = await this.resolveArguments(node)
    
    switch (name) {
      case 'send': {
        const message = String(args.message || args[0] || this._pipeValue || '')
        if (callbacks?.onSend) {
          // 替换变量
          const resolved = replaceVariables(message, this._variables)
          await callbacks.onSend(resolved)
          return { success: true, output: `发送: ${resolved}`, shouldSend: true, modifiedInput: resolved }
        }
        return { success: false, error: '发送功能未启用' }
      }
      
      case 'continue': {
        if (callbacks?.onContinue) {
          await callbacks.onContinue()
          return { success: true, output: '继续生成...' }
        }
        return { success: false, error: '继续功能未启用' }
      }
      
      case 'regenerate':
      case 'regen': {
        if (callbacks?.onRegenerate) {
          await callbacks.onRegenerate()
          return { success: true, output: '重新生成...' }
        }
        return { success: false, error: '重新生成功能未启用' }
      }
      
      case 'swipe': {
        const direction = (args.direction || 'right') as 'left' | 'right'
        if (callbacks?.onSwipe) {
          await callbacks.onSwipe(direction)
          return { success: true, output: `切换回复: ${direction}` }
        }
        return { success: false, error: '切换功能未启用' }
      }
      
      default:
        return { success: false, error: `未知命令: /${name}` }
    }
  }
  
  /**
   * 解析命令参数
   */
  private async resolveArguments(node: CommandStatementNode): Promise<Record<string, VariableValue>> {
    const result: Record<string, VariableValue> = {}
    
    // 位置参数
    for (let i = 0; i < node.arguments.length; i++) {
      const arg = node.arguments[i]
      const value = await this.evaluateExpression(arg.value)
      
      if (arg.name) {
        result[arg.name] = value
      }
      result[i] = value
    }
    
    // 命名参数
    for (const [key, expr] of Object.entries(node.namedArguments)) {
      result[key] = await this.evaluateExpression(expr)
    }
    
    return result
  }
  
  /**
   * 执行管道语句
   */
  private async executePipe(node: PipeStatementNode): Promise<ExecutionResult> {
    let pipeValue: VariableValue = this._pipeValue
    let lastResult: ExecutionResult = { success: true }
    
    for (const command of node.commands) {
      // 设置当前管道值
      this._pipeValue = pipeValue
      
      lastResult = await this.executeCommand(command)
      
      if (!lastResult.success) {
        return lastResult
      }
      
      // 获取输出作为下一个命令的输入
      pipeValue = lastResult.value ?? lastResult.output
    }
    
    return lastResult
  }
  
  /**
   * 执行 IF 语句
   */
  private async executeIf(node: IfStatementNode): Promise<ExecutionResult> {
    const condition = await this.evaluateExpression(node.condition)
    const isTruthy = this.isTruthy(condition)
    
    if (isTruthy) {
      this._variables.pushScope()
      try {
        return await this.executeBlock(node.thenBranch.statements)
      } finally {
        this._variables.popScope()
      }
    } else if (node.elseBranch) {
      if (node.elseBranch.type === NodeType.IF_STATEMENT) {
        // else if
        return this.executeIf(node.elseBranch)
      } else {
        // else block
        this._variables.pushScope()
        try {
          return await this.executeBlock(node.elseBranch.statements)
        } finally {
          this._variables.popScope()
        }
      }
    }
    
    return { success: true }
  }
  
  /**
   * 执行 WHILE 语句
   */
  private async executeWhile(node: WhileStatementNode): Promise<ExecutionResult> {
    const maxIterations = 10000 // 安全限制
    let iterations = 0
    let outputs: string[] = []
    
    while (iterations < maxIterations) {
      this.checkLimits()
      iterations++
      
      const condition = await this.evaluateExpression(node.condition)
      if (!this.isTruthy(condition)) {
        break
      }
      
      this._variables.pushScope()
      try {
        const result = await this.executeBlock(node.body.statements)
        
        if (result.output) {
          outputs.push(result.output)
        }
        
        if (!result.success) {
          return result
        }
        
        if (result.shouldBreak) {
          break
        }
        
        if (result.shouldReturn) {
          return result
        }
      } finally {
        this._variables.popScope()
      }
    }
    
    if (iterations >= maxIterations) {
      return { success: false, error: '循环次数超过限制' }
    }
    
    return { success: true, output: outputs.join('\n') }
  }
  
  /**
   * 执行 RETURN 语句
   */
  private async executeReturn(node: ReturnStatementNode): Promise<ExecutionResult> {
    let value: VariableValue = this._pipeValue
    
    if (node.value) {
      value = await this.evaluateExpression(node.value)
    }
    
    return {
      success: true,
      shouldReturn: true,
      value,
      output: String(value ?? ''),
    }
  }
  
  /**
   * 执行代码块
   */
  async executeBlock(statements: StatementNode[]): Promise<ExecutionResult> {
    return this.executeStatements(statements)
  }
  
  /**
   * 求值表达式
   */
  private async evaluateExpression(expr: ExpressionNode): Promise<VariableValue> {
    switch (expr.type) {
      case NodeType.LITERAL:
        return expr.value
        
      case NodeType.IDENTIFIER:
        return (expr as IdentifierNode).name
        
      case NodeType.VARIABLE_ACCESS:
        return this._variables.get((expr as VariableAccessNode).name)
        
      case NodeType.BINARY_EXPRESSION:
        return this.evaluateBinaryExpression(expr)
        
      case NodeType.UNARY_EXPRESSION:
        return this.evaluateUnaryExpression(expr)
        
      default:
        return undefined
    }
  }
  
  /**
   * 求值二元表达式
   */
  private async evaluateBinaryExpression(expr: BinaryExpressionNode): Promise<VariableValue> {
    const left = await this.evaluateExpression(expr.left)
    const right = await this.evaluateExpression(expr.right)
    
    const leftNum = Number(left)
    const rightNum = Number(right)
    
    switch (expr.operator) {
      // 算术运算
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left ?? '') + String(right ?? '')
        }
        return leftNum + rightNum
      case '-':
        return leftNum - rightNum
      case '*':
        return leftNum * rightNum
      case '/':
        return rightNum !== 0 ? leftNum / rightNum : 0
      case '%':
        return rightNum !== 0 ? leftNum % rightNum : 0
        
      // 比较运算
      case '==':
        return left == right
      case '===':
        return left === right
      case '!=':
        return left != right
      case '!==':
        return left !== right
      case '<':
        return leftNum < rightNum
      case '>':
        return leftNum > rightNum
      case '<=':
        return leftNum <= rightNum
      case '>=':
        return leftNum >= rightNum
        
      // 逻辑运算
      case '&&':
        return this.isTruthy(left) && this.isTruthy(right)
      case '||':
        return this.isTruthy(left) || this.isTruthy(right)
        
      default:
        return undefined
    }
  }
  
  /**
   * 求值一元表达式
   */
  private async evaluateUnaryExpression(expr: UnaryExpressionNode): Promise<VariableValue> {
    const operand = await this.evaluateExpression(expr.operand)
    
    switch (expr.operator) {
      case '!':
        return !this.isTruthy(operand)
      case '-':
        return -Number(operand)
      case '+':
        return +Number(operand)
      default:
        return undefined
    }
  }
  
  /**
   * 判断值是否为真
   */
  private isTruthy(value: VariableValue): boolean {
    if (value === null || value === undefined) return false
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') {
      return value !== '' && value !== '0' && value.toLowerCase() !== 'false'
    }
    return true
  }
  
  /**
   * 检查执行限制
   */
  private checkLimits(): void {
    if (this.stepCount >= this.config.maxSteps) {
      throw new AbortError('执行步数超过限制')
    }
    
    if (this.aborted) {
      throw new AbortError('执行已中止')
    }
  }
  
  /**
   * 中止执行
   */
  abort(): void {
    this.aborted = true
  }
}

/**
 * 中止错误
 */
class AbortError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AbortError'
  }
}

// ============ 扩展 ExecutionResult ============

// 添加缺失的字段
declare module './types' {
  interface ExecutionResult {
    value?: VariableValue
    shouldBreak?: boolean
    shouldContinue?: boolean
    shouldReturn?: boolean
  }
}

// ============ 便捷函数 ============

/**
 * 执行脚本
 */
export async function executeScript(
  script: string,
  context: ExecutionContext,
  config?: ExecutorConfig
): Promise<ExecutionResult> {
  const executor = new ScriptExecutor(context, config)
  return executor.execute(script)
}

/**
 * 解析并验证脚本 (不执行)
 */
export function parseScript(script: string): { success: boolean; error?: string } {
  try {
    const { errors } = parseScriptAST(script)
    if (errors.length > 0) {
      return {
        success: false,
        error: `${errors[0].message} (行 ${errors[0].line}, 列 ${errors[0].column})`,
      }
    }
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
