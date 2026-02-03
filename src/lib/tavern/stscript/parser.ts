/**
 * STscript 解析器
 * 将脚本文本解析为 AST
 */

import {
  Token,
  TokenType,
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
  ParseError,
} from './types'

// ============ Lexer (词法分析器) ============

/**
 * 词法分析器
 */
export class Lexer {
  private source: string
  private pos: number = 0
  private line: number = 1
  private column: number = 1
  private tokens: Token[] = []
  
  constructor(source: string) {
    this.source = source
  }
  
  /**
   * 执行词法分析
   */
  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      this.scanToken()
    }
    
    this.tokens.push({
      type: TokenType.EOF,
      value: '',
      line: this.line,
      column: this.column,
    })
    
    return this.tokens
  }
  
  private isAtEnd(): boolean {
    return this.pos >= this.source.length
  }
  
  private peek(offset: number = 0): string {
    const idx = this.pos + offset
    return idx < this.source.length ? this.source[idx] : '\0'
  }
  
  private advance(): string {
    const char = this.source[this.pos++]
    if (char === '\n') {
      this.line++
      this.column = 1
    } else {
      this.column++
    }
    return char
  }
  
  private addToken(type: TokenType, value: string): void {
    this.tokens.push({
      type,
      value,
      line: this.line,
      column: this.column - value.length,
    })
  }
  
  private scanToken(): void {
    const char = this.peek()
    
    // 换行
    if (char === '\n') {
      this.advance()
      this.addToken(TokenType.NEWLINE, '\n')
      return
    }
    
    // 空白 (忽略但不产生 token)
    if (/\s/.test(char)) {
      this.advance()
      return
    }
    
    // 注释
    if (char === '/' && this.peek(1) === '/') {
      this.scanLineComment()
      return
    }
    
    // 命令 /command
    if (char === '/') {
      // 检查是否是命令 (后面跟字母)
      if (/[a-zA-Z]/.test(this.peek(1))) {
        this.scanCommand()
        return
      }
      // 否则是除法运算符
      this.advance()
      this.addToken(TokenType.SLASH, '/')
      return
    }
    
    // 管道
    if (char === '|') {
      if (this.peek(1) === '|') {
        this.advance()
        this.advance()
        this.addToken(TokenType.OR, '||')
      } else {
        this.advance()
        this.addToken(TokenType.PIPE, '|')
      }
      return
    }
    
    // 变量/宏 {{...}}
    if (char === '{' && this.peek(1) === '{') {
      this.scanVariable()
      return
    }
    
    // 字符串
    if (char === '"' || char === "'") {
      this.scanString(char)
      return
    }
    
    // 数字
    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(this.peek(1)))) {
      this.scanNumber()
      return
    }
    
    // 标识符 (包括关键字)
    if (/[a-zA-Z_]/.test(char)) {
      this.scanIdentifier()
      return
    }
    
    // 操作符和分隔符
    this.scanOperator()
  }
  
  private scanLineComment(): void {
    // 跳过 //
    this.advance()
    this.advance()
    
    let comment = ''
    while (!this.isAtEnd() && this.peek() !== '\n') {
      comment += this.advance()
    }
    
    this.addToken(TokenType.COMMENT, comment)
  }
  
  private scanCommand(): void {
    // 跳过 /
    this.advance()
    
    let name = ''
    while (!this.isAtEnd() && /[a-zA-Z0-9_]/.test(this.peek())) {
      name += this.advance()
    }
    
    this.addToken(TokenType.COMMAND, name)
  }
  
  private scanVariable(): void {
    const startLine = this.line
    const startColumn = this.column
    
    // 跳过 {{
    this.advance()
    this.advance()
    
    let content = ''
    while (!this.isAtEnd()) {
      if (this.peek() === '}' && this.peek(1) === '}') {
        this.advance()
        this.advance()
        break
      }
      content += this.advance()
    }
    
    // 判断是变量还是宏
    const isGlobal = content.startsWith('global.')
    const name = isGlobal ? content.slice(7) : content
    
    // 检查是否是宏调用 (包含 ::)
    if (content.includes('::')) {
      this.tokens.push({
        type: TokenType.MACRO,
        value: content,
        line: startLine,
        column: startColumn,
      })
    } else {
      this.tokens.push({
        type: TokenType.VARIABLE,
        value: content,
        line: startLine,
        column: startColumn,
      })
    }
  }
  
  private scanString(quote: string): void {
    // 跳过开始引号
    this.advance()
    
    let value = ''
    while (!this.isAtEnd() && this.peek() !== quote) {
      // 处理转义
      if (this.peek() === '\\' && this.peek(1) === quote) {
        this.advance()
        value += this.advance()
      } else if (this.peek() === '\\' && this.peek(1) === 'n') {
        this.advance()
        this.advance()
        value += '\n'
      } else {
        value += this.advance()
      }
    }
    
    // 跳过结束引号
    if (!this.isAtEnd()) {
      this.advance()
    }
    
    this.addToken(TokenType.STRING, value)
  }
  
  private scanNumber(): void {
    let value = ''
    
    // 负号
    if (this.peek() === '-') {
      value += this.advance()
    }
    
    // 整数部分
    while (!this.isAtEnd() && /[0-9]/.test(this.peek())) {
      value += this.advance()
    }
    
    // 小数部分
    if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
      value += this.advance()
      while (!this.isAtEnd() && /[0-9]/.test(this.peek())) {
        value += this.advance()
      }
    }
    
    this.addToken(TokenType.NUMBER, value)
  }
  
  private scanIdentifier(): void {
    let value = ''
    while (!this.isAtEnd() && /[a-zA-Z0-9_]/.test(this.peek())) {
      value += this.advance()
    }
    
    // 检查是否是布尔值
    if (value === 'true' || value === 'false') {
      this.addToken(TokenType.BOOLEAN, value)
    } else {
      this.addToken(TokenType.IDENTIFIER, value)
    }
  }
  
  private scanOperator(): void {
    const char = this.advance()
    
    switch (char) {
      case '=':
        if (this.peek() === '=') {
          this.advance()
          this.addToken(TokenType.EQ, '==')
        } else {
          this.addToken(TokenType.EQUALS, '=')
        }
        break
      case '!':
        if (this.peek() === '=') {
          this.advance()
          this.addToken(TokenType.NE, '!=')
        } else {
          this.addToken(TokenType.NOT, '!')
        }
        break
      case '<':
        if (this.peek() === '=') {
          this.advance()
          this.addToken(TokenType.LE, '<=')
        } else {
          this.addToken(TokenType.LT, '<')
        }
        break
      case '>':
        if (this.peek() === '=') {
          this.advance()
          this.addToken(TokenType.GE, '>=')
        } else {
          this.addToken(TokenType.GT, '>')
        }
        break
      case '&':
        if (this.peek() === '&') {
          this.advance()
          this.addToken(TokenType.AND, '&&')
        }
        break
      case '+':
        this.addToken(TokenType.PLUS, '+')
        break
      case '-':
        this.addToken(TokenType.MINUS, '-')
        break
      case '*':
        this.addToken(TokenType.STAR, '*')
        break
      case '%':
        this.addToken(TokenType.PERCENT, '%')
        break
      case '(':
        this.addToken(TokenType.LPAREN, '(')
        break
      case ')':
        this.addToken(TokenType.RPAREN, ')')
        break
      case '[':
        this.addToken(TokenType.LBRACKET, '[')
        break
      case ']':
        this.addToken(TokenType.RBRACKET, ']')
        break
      case '{':
        this.addToken(TokenType.LBRACE, '{')
        break
      case '}':
        this.addToken(TokenType.RBRACE, '}')
        break
      case ',':
        this.addToken(TokenType.COMMA, ',')
        break
      case ':':
        this.addToken(TokenType.COLON, ':')
        break
      default:
        // 其他字符作为文本
        this.addToken(TokenType.TEXT, char)
    }
  }
}

// ============ Parser (语法分析器) ============

/**
 * 语法分析器
 */
export class Parser {
  private tokens: Token[]
  private pos: number = 0
  private errors: ParseError[] = []
  
  constructor(tokens: Token[]) {
    this.tokens = tokens
  }
  
  /**
   * 解析程序
   */
  parse(): { program: ProgramNode; errors: ParseError[] } {
    const statements: StatementNode[] = []
    
    while (!this.isAtEnd()) {
      this.skipNewlines()
      if (this.isAtEnd()) break
      
      const stmt = this.parseStatement()
      if (stmt) {
        statements.push(stmt)
      }
    }
    
    const program: ProgramNode = {
      type: NodeType.PROGRAM,
      statements,
      line: 1,
      column: 1,
    }
    
    return { program, errors: this.errors }
  }
  
  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF
  }
  
  private peek(offset: number = 0): Token {
    const idx = this.pos + offset
    return idx < this.tokens.length 
      ? this.tokens[idx] 
      : this.tokens[this.tokens.length - 1]
  }
  
  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++
    }
    return this.tokens[this.pos - 1]
  }
  
  private check(type: TokenType): boolean {
    return this.peek().type === type
  }
  
  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance()
        return true
      }
    }
    return false
  }
  
  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE) || this.check(TokenType.COMMENT)) {
      this.advance()
    }
  }
  
  private error(message: string): ParseError {
    const token = this.peek()
    const err: ParseError = {
      message,
      line: token.line,
      column: token.column,
    }
    this.errors.push(err)
    return err
  }
  
  /**
   * 解析语句
   */
  private parseStatement(): StatementNode | null {
    // 跳过注释
    if (this.check(TokenType.COMMENT)) {
      this.advance()
      return null
    }
    
    // 命令
    if (this.check(TokenType.COMMAND)) {
      return this.parseCommandOrPipe()
    }
    
    // 变量或宏 (独立使用)
    if (this.check(TokenType.VARIABLE) || this.check(TokenType.MACRO)) {
      const token = this.advance()
      return {
        type: NodeType.TEXT_CONTENT,
        content: `{{${token.value}}}`,
        line: token.line,
        column: token.column,
      }
    }
    
    // 文本
    if (this.check(TokenType.TEXT) || this.check(TokenType.STRING)) {
      return this.parseTextContent()
    }
    
    // 其他 token 也作为文本处理
    const token = this.advance()
    return {
      type: NodeType.TEXT_CONTENT,
      content: token.value,
      line: token.line,
      column: token.column,
    }
  }
  
  /**
   * 解析命令或管道
   */
  private parseCommandOrPipe(): PipeStatementNode | CommandStatementNode {
    const firstCommand = this.parseCommand()
    
    // 检查是否有管道
    if (this.check(TokenType.PIPE)) {
      const commands: CommandStatementNode[] = [firstCommand]
      
      while (this.match(TokenType.PIPE)) {
        this.skipNewlines()
        if (this.check(TokenType.COMMAND)) {
          commands.push(this.parseCommand())
        } else {
          this.error('管道后需要命令')
          break
        }
      }
      
      return {
        type: NodeType.PIPE_STATEMENT,
        commands,
        line: firstCommand.line,
        column: firstCommand.column,
      }
    }
    
    return firstCommand
  }
  
  /**
   * 解析单个命令
   */
  private parseCommand(): CommandStatementNode {
    const cmdToken = this.advance() // COMMAND token
    const command = cmdToken.value
    const line = cmdToken.line
    const column = cmdToken.column
    
    // 检查是否是控制流命令
    if (command === 'if') {
      return this.parseIfCommand(line, column)
    }
    if (command === 'while') {
      return this.parseWhileCommand(line, column)
    }
    if (command === 'break') {
      return {
        type: NodeType.COMMAND_STATEMENT,
        command: 'break',
        arguments: [],
        namedArguments: {},
        line,
        column,
      }
    }
    if (command === 'return') {
      return this.parseReturnCommand(line, column)
    }
    
    // 解析参数
    const args: ArgumentNode[] = []
    const namedArgs: Record<string, ExpressionNode> = {}
    
    // 解析参数直到换行、管道或 EOF
    while (!this.isAtEnd() && 
           !this.check(TokenType.NEWLINE) && 
           !this.check(TokenType.PIPE) &&
           !this.check(TokenType.COMMAND)) {
      
      // 检查是否是命名参数 name=value
      if (this.check(TokenType.IDENTIFIER) && this.peek(1).type === TokenType.EQUALS) {
        const nameToken = this.advance()
        this.advance() // skip =
        const value = this.parseExpression()
        namedArgs[nameToken.value] = value
      } else {
        // 位置参数
        const value = this.parseExpression()
        args.push({
          type: NodeType.ARGUMENT,
          value,
          line: value.line,
          column: value.column,
        })
      }
    }
    
    return {
      type: NodeType.COMMAND_STATEMENT,
      command,
      arguments: args,
      namedArguments: namedArgs,
      line,
      column,
    }
  }
  
  /**
   * 解析 /if 命令
   */
  private parseIfCommand(line: number, column: number): CommandStatementNode {
    // 解析条件
    const condition = this.parseExpression()
    
    // 解析 then 分支 (大括号块或单行命令)
    this.skipNewlines()
    const thenBranch = this.parseBlock()
    
    // 检查 else
    this.skipNewlines()
    let elseBranch: BlockNode | undefined
    if (this.check(TokenType.COMMAND) && this.peek().value === 'else') {
      this.advance() // skip /else
      this.skipNewlines()
      elseBranch = this.parseBlock()
    }
    
    // 转换为命令语句 (执行器会特殊处理)
    return {
      type: NodeType.COMMAND_STATEMENT,
      command: 'if',
      arguments: [{
        type: NodeType.ARGUMENT,
        value: condition,
        line: condition.line,
        column: condition.column,
      }],
      namedArguments: {
        _thenBranch: {
          type: NodeType.LITERAL,
          value: JSON.stringify(thenBranch),
          literalType: 'string',
          line,
          column,
        } as LiteralNode,
        ...(elseBranch && {
          _elseBranch: {
            type: NodeType.LITERAL,
            value: JSON.stringify(elseBranch),
            literalType: 'string',
            line,
            column,
          } as LiteralNode,
        }),
      },
      line,
      column,
    }
  }
  
  /**
   * 解析 /while 命令
   */
  private parseWhileCommand(line: number, column: number): CommandStatementNode {
    const condition = this.parseExpression()
    this.skipNewlines()
    const body = this.parseBlock()
    
    return {
      type: NodeType.COMMAND_STATEMENT,
      command: 'while',
      arguments: [{
        type: NodeType.ARGUMENT,
        value: condition,
        line: condition.line,
        column: condition.column,
      }],
      namedArguments: {
        _body: {
          type: NodeType.LITERAL,
          value: JSON.stringify(body),
          literalType: 'string',
          line,
          column,
        } as LiteralNode,
      },
      line,
      column,
    }
  }
  
  /**
   * 解析 /return 命令
   */
  private parseReturnCommand(line: number, column: number): CommandStatementNode {
    const args: ArgumentNode[] = []
    
    if (!this.check(TokenType.NEWLINE) && !this.check(TokenType.PIPE) && !this.isAtEnd()) {
      const value = this.parseExpression()
      args.push({
        type: NodeType.ARGUMENT,
        value,
        line: value.line,
        column: value.column,
      })
    }
    
    return {
      type: NodeType.COMMAND_STATEMENT,
      command: 'return',
      arguments: args,
      namedArguments: {},
      line,
      column,
    }
  }
  
  /**
   * 解析代码块
   */
  private parseBlock(): BlockNode {
    const startToken = this.peek()
    const statements: StatementNode[] = []
    
    // 大括号块
    if (this.match(TokenType.LBRACE)) {
      this.skipNewlines()
      
      while (!this.isAtEnd() && !this.check(TokenType.RBRACE)) {
        const stmt = this.parseStatement()
        if (stmt) {
          statements.push(stmt)
        }
        this.skipNewlines()
      }
      
      this.match(TokenType.RBRACE)
    } else {
      // 单行命令/语句
      const stmt = this.parseStatement()
      if (stmt) {
        statements.push(stmt)
      }
    }
    
    return {
      type: NodeType.BLOCK,
      statements,
      line: startToken.line,
      column: startToken.column,
    }
  }
  
  /**
   * 解析文本内容
   */
  private parseTextContent(): TextContentNode {
    const token = this.advance()
    return {
      type: NodeType.TEXT_CONTENT,
      content: token.value,
      line: token.line,
      column: token.column,
    }
  }
  
  /**
   * 解析表达式
   */
  private parseExpression(): ExpressionNode {
    return this.parseOr()
  }
  
  /**
   * 解析 OR 表达式
   */
  private parseOr(): ExpressionNode {
    let left = this.parseAnd()
    
    while (this.match(TokenType.OR)) {
      const right = this.parseAnd()
      left = {
        type: NodeType.BINARY_EXPRESSION,
        operator: '||',
        left,
        right,
        line: left.line,
        column: left.column,
      }
    }
    
    return left
  }
  
  /**
   * 解析 AND 表达式
   */
  private parseAnd(): ExpressionNode {
    let left = this.parseEquality()
    
    while (this.match(TokenType.AND)) {
      const right = this.parseEquality()
      left = {
        type: NodeType.BINARY_EXPRESSION,
        operator: '&&',
        left,
        right,
        line: left.line,
        column: left.column,
      }
    }
    
    return left
  }
  
  /**
   * 解析相等性表达式
   */
  private parseEquality(): ExpressionNode {
    let left = this.parseComparison()
    
    while (this.match(TokenType.EQ, TokenType.NE)) {
      const operator = this.tokens[this.pos - 1].value
      const right = this.parseComparison()
      left = {
        type: NodeType.BINARY_EXPRESSION,
        operator,
        left,
        right,
        line: left.line,
        column: left.column,
      }
    }
    
    return left
  }
  
  /**
   * 解析比较表达式
   */
  private parseComparison(): ExpressionNode {
    let left = this.parseAdditive()
    
    while (this.match(TokenType.LT, TokenType.GT, TokenType.LE, TokenType.GE)) {
      const operator = this.tokens[this.pos - 1].value
      const right = this.parseAdditive()
      left = {
        type: NodeType.BINARY_EXPRESSION,
        operator,
        left,
        right,
        line: left.line,
        column: left.column,
      }
    }
    
    return left
  }
  
  /**
   * 解析加法/减法表达式
   */
  private parseAdditive(): ExpressionNode {
    let left = this.parseMultiplicative()
    
    while (this.match(TokenType.PLUS, TokenType.MINUS)) {
      const operator = this.tokens[this.pos - 1].value
      const right = this.parseMultiplicative()
      left = {
        type: NodeType.BINARY_EXPRESSION,
        operator,
        left,
        right,
        line: left.line,
        column: left.column,
      }
    }
    
    return left
  }
  
  /**
   * 解析乘法/除法/模运算表达式
   */
  private parseMultiplicative(): ExpressionNode {
    let left = this.parseUnary()
    
    while (this.match(TokenType.STAR, TokenType.SLASH, TokenType.PERCENT)) {
      const operator = this.tokens[this.pos - 1].value
      const right = this.parseUnary()
      left = {
        type: NodeType.BINARY_EXPRESSION,
        operator,
        left,
        right,
        line: left.line,
        column: left.column,
      }
    }
    
    return left
  }
  
  /**
   * 解析一元表达式
   */
  private parseUnary(): ExpressionNode {
    if (this.match(TokenType.NOT, TokenType.MINUS)) {
      const operator = this.tokens[this.pos - 1].value
      const operand = this.parseUnary()
      return {
        type: NodeType.UNARY_EXPRESSION,
        operator,
        operand,
        line: operand.line,
        column: operand.column,
      }
    }
    
    return this.parsePrimary()
  }
  
  /**
   * 解析主表达式
   */
  private parsePrimary(): ExpressionNode {
    const token = this.peek()
    
    // 字符串
    if (this.match(TokenType.STRING)) {
      return {
        type: NodeType.LITERAL,
        value: token.value,
        literalType: 'string',
        line: token.line,
        column: token.column,
      }
    }
    
    // 数字
    if (this.match(TokenType.NUMBER)) {
      return {
        type: NodeType.LITERAL,
        value: parseFloat(token.value),
        literalType: 'number',
        line: token.line,
        column: token.column,
      }
    }
    
    // 布尔值
    if (this.match(TokenType.BOOLEAN)) {
      return {
        type: NodeType.LITERAL,
        value: token.value === 'true',
        literalType: 'boolean',
        line: token.line,
        column: token.column,
      }
    }
    
    // 变量
    if (this.match(TokenType.VARIABLE)) {
      const isGlobal = token.value.startsWith('global.')
      const name = isGlobal ? token.value.slice(7) : token.value
      return {
        type: NodeType.VARIABLE_ACCESS,
        name,
        isGlobal,
        line: token.line,
        column: token.column,
      }
    }
    
    // 标识符
    if (this.match(TokenType.IDENTIFIER)) {
      return {
        type: NodeType.IDENTIFIER,
        name: token.value,
        line: token.line,
        column: token.column,
      }
    }
    
    // 括号表达式
    if (this.match(TokenType.LPAREN)) {
      const expr = this.parseExpression()
      this.match(TokenType.RPAREN)
      return expr
    }
    
    // 默认: 作为字符串字面量
    this.advance()
    return {
      type: NodeType.LITERAL,
      value: token.value,
      literalType: 'string',
      line: token.line,
      column: token.column,
    }
  }
}

// ============ 导出函数 ============

/**
 * 解析脚本
 */
export function parseScript(source: string): { program: ProgramNode; errors: ParseError[] } {
  const lexer = new Lexer(source)
  const tokens = lexer.tokenize()
  
  const parser = new Parser(tokens)
  return parser.parse()
}

/**
 * 词法分析
 */
export function tokenize(source: string): Token[] {
  const lexer = new Lexer(source)
  return lexer.tokenize()
}
