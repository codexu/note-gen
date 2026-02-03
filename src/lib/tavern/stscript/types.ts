/**
 * STscript 类型定义
 * 基于 SillyTavern 的脚本语言实现核心子集
 */

// ============ Token 类型 ============

/**
 * Token 类型
 */
export enum TokenType {
  // 命令
  COMMAND = 'COMMAND',           // /command
  PIPE = 'PIPE',                 // |
  
  // 字面量
  STRING = 'STRING',             // "..." or '...'
  NUMBER = 'NUMBER',             // 123, 45.67
  BOOLEAN = 'BOOLEAN',           // true, false
  
  // 标识符
  IDENTIFIER = 'IDENTIFIER',     // 变量名/参数名
  VARIABLE = 'VARIABLE',         // {{var}}
  MACRO = 'MACRO',               // {{macro}}
  
  // 操作符
  EQUALS = 'EQUALS',             // =
  PLUS = 'PLUS',                 // +
  MINUS = 'MINUS',               // -
  STAR = 'STAR',                 // *
  SLASH = 'SLASH',               // /
  PERCENT = 'PERCENT',           // %
  
  // 比较
  EQ = 'EQ',                     // ==
  NE = 'NE',                     // !=
  LT = 'LT',                     // <
  GT = 'GT',                     // >
  LE = 'LE',                     // <=
  GE = 'GE',                     // >=
  
  // 逻辑
  AND = 'AND',                   // &&
  OR = 'OR',                     // ||
  NOT = 'NOT',                   // !
  
  // 分隔符
  LPAREN = 'LPAREN',             // (
  RPAREN = 'RPAREN',             // )
  LBRACKET = 'LBRACKET',         // [
  RBRACKET = 'RBRACKET',         // ]
  LBRACE = 'LBRACE',             // {
  RBRACE = 'RBRACE',             // }
  COMMA = 'COMMA',               // ,
  COLON = 'COLON',               // :
  
  // 特殊
  NEWLINE = 'NEWLINE',           // 换行
  WHITESPACE = 'WHITESPACE',     // 空白
  COMMENT = 'COMMENT',           // // 或 /* */
  EOF = 'EOF',                   // 文件结束
  
  // 文本
  TEXT = 'TEXT',                 // 普通文本
}

/**
 * Token
 */
export interface Token {
  type: TokenType
  value: string
  line: number
  column: number
}

// ============ AST 节点类型 ============

/**
 * AST 节点类型
 */
export enum NodeType {
  // 程序
  PROGRAM = 'PROGRAM',
  
  // 语句
  COMMAND_STATEMENT = 'COMMAND_STATEMENT',
  PIPE_STATEMENT = 'PIPE_STATEMENT',
  IF_STATEMENT = 'IF_STATEMENT',
  ELSE_STATEMENT = 'ELSE_STATEMENT',
  WHILE_STATEMENT = 'WHILE_STATEMENT',
  BREAK_STATEMENT = 'BREAK_STATEMENT',
  RETURN_STATEMENT = 'RETURN_STATEMENT',
  
  // 表达式
  LITERAL = 'LITERAL',
  IDENTIFIER = 'IDENTIFIER',
  VARIABLE_ACCESS = 'VARIABLE_ACCESS',
  MACRO_CALL = 'MACRO_CALL',
  BINARY_EXPRESSION = 'BINARY_EXPRESSION',
  UNARY_EXPRESSION = 'UNARY_EXPRESSION',
  CALL_EXPRESSION = 'CALL_EXPRESSION',
  
  // 其他
  ARGUMENT = 'ARGUMENT',
  ARGUMENT_LIST = 'ARGUMENT_LIST',
  BLOCK = 'BLOCK',
  TEXT_CONTENT = 'TEXT_CONTENT',
}

/**
 * 基础 AST 节点
 */
export interface ASTNode {
  type: NodeType
  line: number
  column: number
}

/**
 * 程序节点 (根节点)
 */
export interface ProgramNode extends ASTNode {
  type: NodeType.PROGRAM
  statements: StatementNode[]
}

/**
 * 语句节点
 */
export type StatementNode = 
  | CommandStatementNode 
  | PipeStatementNode 
  | IfStatementNode 
  | WhileStatementNode
  | BreakStatementNode
  | ReturnStatementNode
  | TextContentNode

/**
 * 命令语句节点
 */
export interface CommandStatementNode extends ASTNode {
  type: NodeType.COMMAND_STATEMENT
  command: string
  arguments: ArgumentNode[]
  /** 命名参数 */
  namedArguments: Record<string, ExpressionNode>
}

/**
 * 管道语句节点
 */
export interface PipeStatementNode extends ASTNode {
  type: NodeType.PIPE_STATEMENT
  commands: CommandStatementNode[]
}

/**
 * IF 语句节点
 */
export interface IfStatementNode extends ASTNode {
  type: NodeType.IF_STATEMENT
  condition: ExpressionNode
  thenBranch: BlockNode
  elseBranch?: BlockNode | IfStatementNode
}

/**
 * WHILE 语句节点
 */
export interface WhileStatementNode extends ASTNode {
  type: NodeType.WHILE_STATEMENT
  condition: ExpressionNode
  body: BlockNode
}

/**
 * BREAK 语句节点
 */
export interface BreakStatementNode extends ASTNode {
  type: NodeType.BREAK_STATEMENT
}

/**
 * RETURN 语句节点
 */
export interface ReturnStatementNode extends ASTNode {
  type: NodeType.RETURN_STATEMENT
  value?: ExpressionNode
}

/**
 * 代码块节点
 */
export interface BlockNode extends ASTNode {
  type: NodeType.BLOCK
  statements: StatementNode[]
}

/**
 * 文本内容节点
 */
export interface TextContentNode extends ASTNode {
  type: NodeType.TEXT_CONTENT
  content: string
}

/**
 * 表达式节点
 */
export type ExpressionNode = 
  | LiteralNode 
  | IdentifierNode 
  | VariableAccessNode 
  | MacroCallNode
  | BinaryExpressionNode 
  | UnaryExpressionNode
  | CallExpressionNode

/**
 * 字面量节点
 */
export interface LiteralNode extends ASTNode {
  type: NodeType.LITERAL
  value: string | number | boolean
  literalType: 'string' | 'number' | 'boolean'
}

/**
 * 标识符节点
 */
export interface IdentifierNode extends ASTNode {
  type: NodeType.IDENTIFIER
  name: string
}

/**
 * 变量访问节点 {{var}}
 */
export interface VariableAccessNode extends ASTNode {
  type: NodeType.VARIABLE_ACCESS
  name: string
  /** 是否全局变量 */
  isGlobal: boolean
}

/**
 * 宏调用节点 {{macro}}
 */
export interface MacroCallNode extends ASTNode {
  type: NodeType.MACRO_CALL
  name: string
  arguments: ExpressionNode[]
}

/**
 * 二元表达式节点
 */
export interface BinaryExpressionNode extends ASTNode {
  type: NodeType.BINARY_EXPRESSION
  operator: string
  left: ExpressionNode
  right: ExpressionNode
}

/**
 * 一元表达式节点
 */
export interface UnaryExpressionNode extends ASTNode {
  type: NodeType.UNARY_EXPRESSION
  operator: string
  operand: ExpressionNode
}

/**
 * 函数调用表达式节点
 */
export interface CallExpressionNode extends ASTNode {
  type: NodeType.CALL_EXPRESSION
  callee: string
  arguments: ExpressionNode[]
}

/**
 * 参数节点
 */
export interface ArgumentNode extends ASTNode {
  type: NodeType.ARGUMENT
  /** 参数名 (可选，用于命名参数) */
  name?: string
  /** 参数值 */
  value: ExpressionNode
}

// ============ 执行相关类型 ============

/**
 * 执行上下文
 */
export interface ExecutionContext {
  /** 聊天 ID */
  chatId?: number
  /** 角色 ID */
  cardId?: number
  /** 角色名 */
  characterName?: string
  /** 用户名 */
  userName?: string
  /** 上一个命令的输出 (管道传递) */
  pipeValue?: string
  /** 是否在循环中 */
  inLoop?: boolean
  /** 是否请求中断 */
  breakRequested?: boolean
  /** 最大执行步数 (防止无限循环) */
  maxSteps?: number
  /** 当前执行步数 */
  currentStep?: number
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  /** 是否成功 */
  success: boolean
  /** 输出值 */
  output?: string
  /** 错误信息 */
  error?: string
  /** 是否需要发送消息 */
  shouldSend?: boolean
  /** 修改后的输入 */
  modifiedInput?: string
  /** 是否请求中断 */
  breakRequested?: boolean
  /** 返回值 */
  returnValue?: string
}

/**
 * 命令定义
 */
export interface ScriptCommand {
  /** 命令名 */
  name: string
  /** 别名 */
  aliases: string[]
  /** 描述 */
  description: string
  /** 参数定义 */
  parameters: CommandParameter[]
  /** 执行函数 */
  execute: (args: Record<string, unknown>, context: ExecutionContext) => Promise<ExecutionResult>
  /** 是否返回值 (用于管道) */
  returnsValue: boolean
}

/**
 * 命令参数定义
 */
export interface CommandParameter {
  /** 参数名 */
  name: string
  /** 类型 */
  type: 'string' | 'number' | 'boolean' | 'expression'
  /** 描述 */
  description: string
  /** 是否必需 */
  required: boolean
  /** 默认值 */
  defaultValue?: unknown
  /** 是否接收管道值 */
  acceptsPipe?: boolean
}

/**
 * 变量作用域
 */
export interface VariableScope {
  /** 全局变量 */
  global: Map<string, string>
  /** 聊天级变量 */
  chat: Map<number, Map<string, string>>
  /** 局部变量 (脚本执行期间) */
  local: Map<string, string>
}

/**
 * 解析错误
 */
export interface ParseError {
  message: string
  line: number
  column: number
  source?: string
}

/**
 * 执行错误
 */
export interface ExecutionError {
  message: string
  command?: string
  line?: number
  column?: number
  stack?: string
}
