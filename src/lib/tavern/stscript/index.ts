/**
 * STscript 模块导出
 */

// 类型
export type {
  Token,
  TokenType,
  NodeType,
  ASTNode,
  ProgramNode,
  StatementNode,
  ExpressionNode,
  ExecutionContext,
  ExecutionResult,
  ParseError,
  ExecutionError,
} from './types'

// 解析器
export { Parser, Lexer } from './parser'

// 变量管理
export {
  VariableManager,
  VariableScopeType,
  getVariableManager,
  createVariableManager,
  parseVariableExpression,
  replaceVariables,
  evaluateCondition,
} from './variables'
export type { VariableValue, Variable } from './variables'

// 命令
export {
  registerCommand,
  getCommand,
  getAllCommands,
  commandRegistry,
} from './commands'
export type {
  ScriptCommand,
  CommandHandler,
  CommandParam,
  CommandExecutorInterface,
} from './commands'

// 执行器
export {
  ScriptExecutor,
  executeScript,
  parseScript,
} from './executor'
export type { ExecutorConfig, ExecutorCallbacks } from './executor'
