/**
 * Tavern Tool Calling 服务
 * 处理工具调用的执行
 * 实现类似 SillyTavern 的 ToolManager 和 ToolDefinition
 */

import { 
  useTavernToolCallingStore, 
  Tool,
  ToolCall,
  ToolCallResult,
  ToolParameter,
} from '@/stores/tavern-tool-calling'
import { getContextForQuery, Keyword } from '@/lib/rag'

// ============================================================================
// Types
// ============================================================================

/**
 * 工具调用 (来自 AI 响应)
 */
export interface ToolInvocation {
  id: string
  displayName: string
  name: string
  parameters: string
  result: string
  signature?: string | null
}

/**
 * 工具调用结果
 */
export interface ToolInvocationResult {
  invocations: ToolInvocation[]
  errors: Error[]
  stealthCalls: string[]
}

/**
 * 工具注册参数
 */
export interface ToolRegistration {
  name: string
  displayName?: string
  description: string
  parameters: Record<string, unknown>
  action: (params: Record<string, unknown>) => Promise<unknown>
  formatMessage?: (params: Record<string, unknown>) => Promise<string>
  shouldRegister?: () => Promise<boolean>
  stealth?: boolean
}

/**
 * OpenAI 函数工具定义格式
 */
export interface ToolDefinitionOpenAI {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

// ============================================================================
// ToolDefinition Class
// ============================================================================

/**
 * 工具定义类
 * 类似 SillyTavern 的 ToolDefinition
 */
export class ToolDefinition {
  private _name: string
  private _displayName: string
  private _description: string
  private _parameters: Record<string, unknown>
  private _action: (params: Record<string, unknown>) => Promise<unknown>
  private _formatMessage?: (params: Record<string, unknown>) => Promise<string>
  private _shouldRegister?: () => Promise<boolean>
  private _stealth: boolean

  constructor(
    name: string,
    displayName: string,
    description: string,
    parameters: Record<string, unknown>,
    action: (params: Record<string, unknown>) => Promise<unknown>,
    formatMessage?: (params: Record<string, unknown>) => Promise<string>,
    shouldRegister?: () => Promise<boolean>,
    stealth = false
  ) {
    this._name = name
    this._displayName = displayName || name
    this._description = description
    this._parameters = parameters
    this._action = action
    this._formatMessage = formatMessage
    this._shouldRegister = shouldRegister
    this._stealth = stealth
  }

  /**
   * 转换为 OpenAI API 格式
   */
  toFunctionOpenAI(): ToolDefinitionOpenAI {
    return {
      type: 'function',
      function: {
        name: this._name,
        description: this._description,
        parameters: this._parameters,
      },
    }
  }

  /**
   * 调用工具
   */
  async invoke(parameters: Record<string, unknown>): Promise<unknown> {
    return await this._action(parameters)
  }

  /**
   * 格式化工具调用消息
   */
  async formatMessage(parameters: Record<string, unknown>): Promise<string> {
    if (typeof this._formatMessage === 'function') {
      return await this._formatMessage(parameters)
    }
    return `调用工具: ${this._displayName || this._name}`
  }

  /**
   * 检查是否应该注册
   */
  async shouldRegister(): Promise<boolean> {
    if (typeof this._shouldRegister === 'function') {
      return await this._shouldRegister()
    }
    return true
  }

  get name(): string {
    return this._name
  }

  get displayName(): string {
    return this._displayName
  }

  get description(): string {
    return this._description
  }

  get stealth(): boolean {
    return this._stealth
  }

  get parameters(): Record<string, unknown> {
    return this._parameters
  }
}

// ============================================================================
// ToolManager Class
// ============================================================================

/**
 * 工具管理器
 * 类似 SillyTavern 的 ToolManager
 */
export class ToolManager {
  private static tools: Map<string, ToolDefinition> = new Map()
  
  /** 递归调用最大次数 */
  static RECURSE_LIMIT = 5

  /**
   * 获取所有注册的工具
   */
  static getTools(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /**
   * 注册函数工具
   */
  static registerFunctionTool(registration: ToolRegistration): void {
    const {
      name,
      displayName = '',
      description,
      parameters,
      action,
      formatMessage,
      shouldRegister,
      stealth = false,
    } = registration

    if (this.tools.has(name)) {
      console.warn(`[ToolManager] 工具 "${name}" 已存在，将被覆盖`)
    }

    const definition = new ToolDefinition(
      name,
      displayName,
      description,
      parameters,
      action,
      formatMessage,
      shouldRegister,
      stealth
    )

    this.tools.set(name, definition)
    console.log('[ToolManager] 注册工具:', name)
  }

  /**
   * 注销函数工具
   */
  static unregisterFunctionTool(name: string): void {
    if (!this.tools.has(name)) {
      return
    }
    this.tools.delete(name)
    console.log(`[ToolManager] 注销工具: ${name}`)
  }

  /**
   * 解析工具调用参数
   */
  private static parseParameters(parameters: unknown): Record<string, unknown> {
    if (parameters === '' || parameters === null || parameters === undefined) {
      return {}
    }
    if (typeof parameters === 'string') {
      return JSON.parse(parameters)
    }
    return parameters as Record<string, unknown>
  }

  /**
   * 调用函数工具
   */
  static async invokeFunctionTool(
    name: string,
    parameters: unknown
  ): Promise<string | Error> {
    try {
      if (!this.tools.has(name)) {
        throw new Error(`未注册工具: "${name}"`)
      }

      const invokeParameters = this.parseParameters(parameters)
      const tool = this.tools.get(name)!
      const result = await tool.invoke(invokeParameters)
      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (error) {
      console.error(`[ToolManager] 调用工具 "${name}" 时出错:`, error)

      if (error instanceof Error) {
        (error as Error & { cause?: string }).cause = name
        return error
      }

      return new Error('调用工具时发生未知错误')
    }
  }

  /**
   * 检查是否为隐形工具
   */
  static isStealthTool(name: string): boolean {
    if (!this.tools.has(name)) {
      return false
    }
    return !!this.tools.get(name)!.stealth
  }

  /**
   * 格式化工具调用消息
   */
  static async formatToolCallMessage(
    name: string,
    parameters: unknown
  ): Promise<string> {
    if (!this.tools.has(name)) {
      return `调用未知工具: ${name}`
    }

    try {
      const tool = this.tools.get(name)!
      const formatParameters = this.parseParameters(parameters)
      return await tool.formatMessage(formatParameters)
    } catch (error) {
      console.error(`[ToolManager] 格式化工具消息 "${name}" 时出错:`, error)
      return `调用工具: ${name}`
    }
  }

  /**
   * 获取工具显示名称
   */
  static getDisplayName(name: string): string {
    if (!this.tools.has(name)) {
      return name
    }
    return this.tools.get(name)!.displayName || name
  }

  /**
   * 注册函数工具到请求数据 (OpenAI 格式)
   */
  static async registerFunctionToolsOpenAI(
    data: Record<string, unknown>
  ): Promise<void> {
    const tools: ToolDefinitionOpenAI[] = []

    for (const tool of this.tools.values()) {
      const register = await tool.shouldRegister()
      if (!register) {
        console.log('[ToolManager] 跳过工具注册:', tool.name)
        continue
      }
      tools.push(tool.toFunctionOpenAI())
    }

    if (tools.length) {
      console.log('[ToolManager] 注册函数工具:', tools)
      data['tools'] = tools
      data['tool_choice'] = 'auto'
    }
  }

  /**
   * 检查响应数据是否包含工具调用
   */
  static hasToolCalls(data: unknown): boolean {
    const toolCalls = this.getToolCallsFromData(data)
    return Array.isArray(toolCalls) && toolCalls.length > 0
  }

  /**
   * 从响应数据中获取工具调用
   */
  private static getToolCallsFromData(
    data: unknown
  ): Array<{ id: string; function: { name: string; arguments: unknown }; signature?: string }> {
    const getRandomId = () => Math.random().toString(36).substring(2)

    // OpenAI 格式
    if (typeof data === 'object' && data !== null) {
      const d = data as Record<string, unknown>
      
      // 标准 OpenAI 响应
      if (Array.isArray(d.choices)) {
        const choice = (d.choices as Array<Record<string, unknown>>).find(
          (c) => c.index === 0
        )
        if (
          choice &&
          typeof choice.message === 'object' &&
          choice.message !== null
        ) {
          const message = choice.message as Record<string, unknown>
          if (Array.isArray(message.tool_calls)) {
            return message.tool_calls as Array<{
              id: string
              function: { name: string; arguments: unknown }
            }>
          }
        }
      }

      // Claude 格式
      if (Array.isArray(d.content)) {
        const toolUse = (d.content as Array<Record<string, unknown>>)
          .filter((c) => c.type === 'tool_use')
          .map((c) => ({
            id: c.id as string,
            function: {
              name: c.name as string,
              arguments: c.input,
            },
          }))
        if (toolUse.length > 0) {
          return toolUse
        }
      }

      // Google 格式
      if (
        typeof d.responseContent === 'object' &&
        d.responseContent !== null
      ) {
        const rc = d.responseContent as Record<string, unknown>
        if (Array.isArray(rc.parts)) {
          return (rc.parts as Array<Record<string, unknown>>)
            .filter((p) => p.functionCall)
            .map((p) => {
              const fc = p.functionCall as Record<string, unknown>
              return {
                id: getRandomId(),
                function: {
                  name: fc.name as string,
                  arguments: fc.args,
                },
                signature: (p.thoughtSignature as string) || undefined,
              }
            })
        }
      }
    }

    return []
  }

  /**
   * 调用函数工具并返回结果
   */
  static async invokeFunctionTools(
    data: unknown
  ): Promise<ToolInvocationResult> {
    const result: ToolInvocationResult = {
      invocations: [],
      errors: [],
      stealthCalls: [],
    }

    const toolCalls = this.getToolCallsFromData(data)

    if (!Array.isArray(toolCalls)) {
      return result
    }

    for (const toolCall of toolCalls) {
      if (
        !toolCall ||
        !toolCall.function ||
        typeof toolCall.function !== 'object'
      ) {
        continue
      }

      console.log('[ToolManager] 函数工具调用:', toolCall)
      const id = toolCall.id
      const parameters = toolCall.function.arguments
      const name = toolCall.function.name
      const displayName = this.getDisplayName(name)
      const isStealth = this.isStealthTool(name)

      const toolResult = await this.invokeFunctionTool(name, parameters)
      console.log('[ToolManager] 函数工具结果:', toolResult)

      // 保存成功的调用
      if (toolResult instanceof Error) {
        result.errors.push(toolResult)
        continue
      }

      // 不保存隐形工具调用
      if (isStealth) {
        result.stealthCalls.push(name)
        continue
      }

      const invocation: ToolInvocation = {
        id,
        displayName,
        name,
        parameters:
          typeof parameters === 'string'
            ? parameters
            : JSON.stringify(parameters),
        result: toolResult,
        signature: toolCall.signature || null,
      }
      result.invocations.push(invocation)
    }

    return result
  }

  /**
   * 格式化工具调用消息 (用于显示)
   */
  static formatToolInvocationMessage(invocations: ToolInvocation[]): string {
    if (!invocations.length) return ''

    const data = structuredClone(invocations)

    // 解析参数和结果
    data.forEach((i) => {
      try {
        i.parameters = JSON.parse(i.parameters)
      } catch {
        // 保持原样
      }
      try {
        i.result = JSON.parse(i.result)
      } catch {
        // 保持原样
      }
    })

    const toolNames = data.map((i) => i.displayName || i.name)
    const groupedNames = this.groupToolNames(toolNames)

    return `<details>
<summary>工具调用: ${groupedNames}</summary>
<pre><code class="language-json">${JSON.stringify(data, null, 2)}</code></pre>
</details>`
  }

  /**
   * 分组工具名称
   */
  private static groupToolNames(toolNames: string[]): string {
    const toolCounts: Record<string, number> = {}
    for (const name of toolNames) {
      toolCounts[name] = (toolCounts[name] || 0) + 1
    }
    return Object.entries(toolCounts)
      .map(([name, count]) => (count > 1 ? `${name} (${count})` : name))
      .join(', ')
  }

  /**
   * 从 Store 工具定义创建 ToolDefinition
   */
  static registerFromStoreTool(tool: Tool): void {
    // 将 ToolParameter[] 转换为 JSON Schema 格式
    const parametersSchema = this.convertParametersToSchema(tool.parameters)

    this.registerFunctionTool({
      name: tool.name,
      displayName: tool.name,
      description: tool.description,
      parameters: parametersSchema,
      action: async (params) => {
        // 使用现有的执行逻辑
        return await executeBuiltinToolInternal(tool, params)
      },
      stealth: false,
    })
  }

  /**
   * 将 ToolParameter[] 转换为 JSON Schema 格式
   */
  private static convertParametersToSchema(
    params: ToolParameter[]
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const param of params) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
        ...(param.enum ? { enum: param.enum } : {}),
      }
      if (param.required) {
        required.push(param.name)
      }
    }

    return {
      type: 'object',
      properties,
      required,
    }
  }

  /**
   * 清空所有注册的工具
   */
  static clearTools(): void {
    this.tools.clear()
  }

  /**
   * 检查工具是否存在
   */
  static hasTool(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * 获取工具
   */
  static getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }
}

/**
 * 执行工具调用
 */
export async function executeToolCall(
  call: ToolCall
): Promise<ToolCallResult> {
  const store = useTavernToolCallingStore.getState()
  const tool = store.getToolByName(call.toolName)
  
  if (!tool) {
    return {
      callId: call.id,
      toolName: call.toolName,
      success: false,
      error: `未找到工具: ${call.toolName}`,
      timestamp: Date.now(),
    }
  }
  
  try {
    const result = await executeBuiltinTool(tool, call.arguments)
    
    const callResult: ToolCallResult = {
      callId: call.id,
      toolName: call.toolName,
      success: true,
      result,
      timestamp: Date.now(),
    }
    
    store.addCallResult(callResult)
    return callResult
  } catch (error) {
    const callResult: ToolCallResult = {
      callId: call.id,
      toolName: call.toolName,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    }
    
    store.addCallResult(callResult)
    return callResult
  }
}

/**
 * 执行内置工具
 */
async function executeBuiltinTool(
  tool: Tool,
  args: Record<string, unknown>
): Promise<string> {
  switch (tool.name) {
    case 'search_notes': {
      const query = String(args.query || '')
      // limit 参数由 RAG 配置控制
      const _limit = Number(args.limit || 5)
      void _limit // 使用 void 避免未使用警告
      
      if (!query) {
        return '请提供搜索关键词'
      }
      
      const keywords: Keyword[] = query.split(/\s+/).map(text => ({
        text,
        weight: 1,
      }))
      
      const { context, sources } = await getContextForQuery(keywords)
      
      if (!context) {
        return '未找到相关笔记'
      }
      
      return `找到 ${sources.length} 个相关笔记:\n${context}`
    }
    
    case 'search_world_info': {
      const query = String(args.query || '')
      // TODO: 实现 World Info 搜索
      return `World Info 搜索: ${query} (功能开发中)`
    }
    
    case 'calculate': {
      const expression = String(args.expression || '')
      
      // 安全的数学计算 (只允许数字和基本运算符)
      if (!/^[\d\s+\-*/().%^]+$/.test(expression)) {
        return '无效的数学表达式'
      }
      
      try {
        // 替换 ^ 为 **
        const safeExpr = expression.replace(/\^/g, '**')
        // eslint-disable-next-line no-eval
        const result = eval(safeExpr)
        return `${expression} = ${result}`
      } catch {
        return '计算错误'
      }
    }
    
    case 'get_current_time': {
      const format = String(args.format || 'full')
      const now = new Date()
      
      switch (format) {
        case 'time':
          return now.toLocaleTimeString('zh-CN')
        case 'date':
          return now.toLocaleDateString('zh-CN')
        case 'iso':
          return now.toISOString()
        case 'full':
        default:
          return now.toLocaleString('zh-CN')
      }
    }
    
    case 'get_date_diff': {
      const date1 = new Date(String(args.date1))
      const date2 = args.date2 ? new Date(String(args.date2)) : new Date()
      
      if (isNaN(date1.getTime())) {
        return '无效的日期格式'
      }
      
      const diffMs = Math.abs(date2.getTime() - date1.getTime())
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      
      return `相差 ${diffDays} 天`
    }
    
    case 'roll_dice': {
      const sides = Number(args.sides || 6)
      const count = Number(args.count || 1)
      
      const rolls: number[] = []
      for (let i = 0; i < count; i++) {
        rolls.push(Math.floor(Math.random() * sides) + 1)
      }
      
      const total = rolls.reduce((a, b) => a + b, 0)
      
      if (count === 1) {
        return `🎲 掷出: ${rolls[0]}`
      }
      return `🎲 掷出: ${rolls.join(', ')} (总计: ${total})`
    }
    
    case 'random_choice': {
      const options = args.options as string[]
      
      if (!Array.isArray(options) || options.length === 0) {
        return '请提供选项列表'
      }
      
      const choice = options[Math.floor(Math.random() * options.length)]
      return `随机选择: ${choice}`
    }
    
    case 'count_words': {
      const text = String(args.text || '')
      
      // 中文字符数
      const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
      // 英文单词数
      const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
      // 总字符数 (不含空格)
      const totalChars = text.replace(/\s/g, '').length
      
      return `字符数: ${totalChars}, 中文: ${chineseChars}, 英文单词: ${englishWords}`
    }
    
    case 'summarize': {
      const text = String(args.text || '')
      const maxLength = Number(args.maxLength || 100)
      
      if (!text) {
        return '请提供文本内容'
      }
      
      // 简单的截断摘要
      if (text.length <= maxLength) {
        return text
      }
      
      return text.slice(0, maxLength) + '...'
    }
    
    default:
      // 自定义工具
      if (tool.template) {
        let result = tool.template
        for (const [key, value] of Object.entries(args)) {
          result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value))
        }
        return result
      }
      
      return `未实现的工具: ${tool.name}`
  }
}

/**
 * 执行内置工具 (内部版本，供 ToolManager 使用)
 */
export async function executeBuiltinToolInternal(
  tool: Tool,
  args: Record<string, unknown>
): Promise<string> {
  return executeBuiltinTool(tool, args)
}

/**
 * 解析 AI 响应中的工具调用
 */
export function parseToolCalls(response: string): ToolCall[] {
  const calls: ToolCall[] = []
  
  // 解析 JSON 格式的工具调用
  // 格式: <tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>
  const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g
  let match
  
  while ((match = toolCallRegex.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed.name) {
        calls.push({
          id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          toolName: parsed.name,
          arguments: parsed.arguments || {},
          timestamp: Date.now(),
        })
      }
    } catch {
      // 忽略解析错误
    }
  }
  
  return calls
}

/**
 * 格式化工具调用结果
 */
export function formatToolResult(result: ToolCallResult): string {
  if (result.success) {
    return `[工具调用: ${result.toolName}]\n${result.result}`
  }
  return `[工具调用失败: ${result.toolName}]\n错误: ${result.error}`
}

/**
 * 批量执行工具调用
 */
export async function executeToolCalls(
  calls: ToolCall[]
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = []
  
  for (const call of calls) {
    const result = await executeToolCall(call)
    results.push(result)
  }
  
  return results
}

/**
 * 获取工具定义 (用于 AI 提示)
 */
export function getToolDefinitionsPrompt(): string {
  const store = useTavernToolCallingStore.getState()
  const tools = store.getToolsForAI()
  
  if (tools.length === 0) return ''
  
  let prompt = '你可以使用以下工具:\n\n'
  
  tools.forEach(tool => {
    prompt += `- ${tool.function.name}: ${tool.function.description}\n`
    const params = tool.function.parameters as { properties?: Record<string, { description?: string }> }
    if (params.properties) {
      Object.entries(params.properties).forEach(([name, prop]) => {
        prompt += `  - ${name}: ${prop.description || ''}\n`
      })
    }
  })
  
  prompt += '\n要调用工具，请使用以下格式:\n'
  prompt += '<tool_call>{"name": "工具名", "arguments": {"参数名": "参数值"}}</tool_call>\n'
  
  return prompt
}
