import { ReActStep, ToolCall, ToolResult } from './types'
import { getToolByName, getToolDescriptions } from './tools'

export interface ReActConfig {
  maxIterations: number
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onIterationStart?: () => void
  requestConfirmation?: (toolName: string, params: Record<string, any>) => Promise<boolean>
}

export class ReActAgent {
  private config: ReActConfig
  private steps: ReActStep[] = []
  private currentIteration = 0
  private toolCallCounter = 0
  private stopped = false

  constructor(config: ReActConfig) {
    this.config = config
    if (!this.config.maxIterations) {
      this.config.maxIterations = 15
    }
  }

  stop() {
    this.stopped = true
  }

  async run(userInput: string, context?: string): Promise<string> {
    this.steps = []
    this.currentIteration = 0
    this.toolCallCounter = 0
    this.stopped = false

    const systemPrompt = this.buildSystemPrompt()
    let finalAnswer = ''

    while (this.currentIteration < this.config.maxIterations) {
      // 检查是否已停止
      if (this.stopped) {
        return '' // 返回空字符串表示被用户终止
      }

      this.currentIteration++

      // 在新迭代开始时，通知保存上一次的思考到历史
      if (this.currentIteration > 1) {
        this.config.onIterationStart?.()
      }

      const thought = await this.think(userInput, context, systemPrompt)
      
      // 再次检查是否已停止
      if (this.stopped) {
        return '' // 返回空字符串表示被用户终止
      }

      if (thought.includes('Final Answer:')) {
        finalAnswer = thought.split('Final Answer:')[1].trim()
        break
      }

      const action = this.parseAction(thought)
      if (!action) {
        finalAnswer = '抱歉，我无法理解如何执行这个任务。'
        break
      }

      this.config.onAction?.(action.tool, action.params)

      const observation = await this.act(action.tool, action.params)
      
      // 检查是否已停止
      if (this.stopped) {
        return '' // 返回空字符串表示被用户终止
      }
      
      this.config.onObservation?.(observation)

      this.steps.push({
        thought,
        action,
        observation,
      })

      if (observation.includes('错误') || observation.includes('失败')) {
        if (this.currentIteration >= this.config.maxIterations - 1) {
          finalAnswer = `执行过程中遇到问题：${observation}`
          break
        }
      }
    }

    if (!finalAnswer && this.currentIteration >= this.config.maxIterations) {
      finalAnswer = '已达到最大迭代次数，任务可能未完全完成。'
    }

    return finalAnswer || '任务执行完成。'
  }

  private buildSystemPrompt(): string {
    const toolDescriptions = getToolDescriptions()
    
    return `你是一个高效的智能助手 Agent，使用工具帮助用户完成任务。遵循 ReAct 框架：Thought（思考）→ Action（行动）→ Observation（观察）。

## 核心原则

**效率优先**：尽量用最少的步骤完成任务，避免不必要的思考和操作。
**直接行动**：如果任务明确，直接执行，不要过度分析。
**快速结束**：完成核心任务后立即给出 Final Answer。

## 可用工具

${toolDescriptions}

## 输出格式要求

你的每次回复**必须严格遵循**以下格式之一：

### 格式 1：思考并执行工具
\`\`\`
Thought: [详细的思考过程，说明为什么要执行这个操作]
Action: tool_name
Action Input: {"param1": "value1", "param2": "value2"}
\`\`\`

**示例：**
\`\`\`
Thought: 用户想要整理 React 笔记，我需要先搜索所有包含 React 关键词的笔记
Action: search_notes
Action Input: {"query": "React"}
\`\`\`

### 格式 2：给出最终答案
\`\`\`
Thought: 我已经完成了所有必要的操作，可以给出最终答案了
Final Answer: [完整的、对用户友好的最终答案]
\`\`\`

**示例：**
\`\`\`
Thought: 我已经成功创建了 React 知识总结笔记，任务完成
Final Answer: 已为您整理完成！我创建了一个名为"React 知识总结"的笔记，包含了 5 条相关笔记的内容整理。
\`\`\`

## 重要规则

1. **严格格式**：Thought → Action + Action Input 或 Final Answer
2. **JSON 格式**：Action Input 必须是有效 JSON，使用双引号
3. **一次一个工具**：每次只调用一个工具
4. **快速完成**：完成核心任务后立即给出 Final Answer，不要做额外操作
5. **只用可用工具**：不要编造工具或参数
6. **简洁思考**：Thought 保持简短，直接说明要做什么

## 示例

**用户**："创建一个笔记介绍 NoteGen"

**Iteration 1:**
\`\`\`
Thought: 直接创建笔记
Action: create_markdown_file
Action Input: {"fileName": "NoteGen介绍.md", "content": "# NoteGen\\n\\n智能笔记软件..."}
\`\`\`
Observation: 成功创建文件

**Iteration 2:**
\`\`\`
Thought: 任务完成
Final Answer: 已创建笔记"NoteGen介绍.md"
\`\`\`

现在开始执行任务！`
  }

  private async think(userInput: string, context: string | undefined, systemPrompt: string): Promise<string> {
    const historyContext = this.steps.map((step, i) => 
      `Iteration ${i + 1}:
Thought: ${step.thought}
Action: ${step.action?.tool}
Action Input: ${JSON.stringify(step.action?.params)}
Observation: ${step.observation}
`
    ).join('\n')

    const prompt = `${systemPrompt}

${context ? `## 上下文信息\n${context}\n` : ''}

## 对话历史
${historyContext}

## 用户请求
${userInput}

现在是第 ${this.currentIteration} 次迭代，请给出你的 Thought 和 Action（或 Final Answer）：`

    // 调用实际的 LLM API
    try {
      const { fetchAiStream } = await import('@/lib/ai')
      let response = ''
      
      await fetchAiStream(prompt, (content) => {
        response = content
        // 实时更新思考内容
        this.config.onThought?.(content)
      })
      
      return response
    } catch (error) {
      console.error('LLM API call failed:', error)
      // 如果 API 调用失败，返回错误提示
      return `Thought: 抱歉，AI 服务暂时不可用
Final Answer: 无法完成任务，请稍后重试或检查 AI 配置`
    }
  }

  private parseAction(thought: string): { tool: string; params: Record<string, any> } | null {
    try {
      const actionMatch = thought.match(/Action:\s*(\w+)/i)
      
      if (!actionMatch) return null

      const tool = actionMatch[1]
      let params = {}
      
      // 使用更宽松的正则匹配，获取 Action Input 后的所有内容
      const inputMatch = thought.match(/Action Input:\s*({[\s\S]*)/i)
      
      if (inputMatch) {
        let jsonStr = inputMatch[1].trim()
        
        // 尝试找到完整的 JSON 对象
        let braceCount = 0
        let jsonEnd = -1
        let inString = false
        let escapeNext = false
        
        for (let i = 0; i < jsonStr.length; i++) {
          const char = jsonStr[i]
          
          if (escapeNext) {
            escapeNext = false
            continue
          }
          
          if (char === '\\') {
            escapeNext = true
            continue
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString
            continue
          }
          
          if (!inString) {
            if (char === '{') {
              braceCount++
            } else if (char === '}') {
              braceCount--
              if (braceCount === 0) {
                jsonEnd = i + 1
                break
              }
            }
          }
        }
        
        // 如果找到了完整的 JSON，截取它
        if (jsonEnd > 0) {
          jsonStr = jsonStr.substring(0, jsonEnd)
        }
        
        try {
          params = JSON.parse(jsonStr)
        } catch {
          // JSON 解析失败，尝试修复
          console.warn('JSON parse failed, attempting repair:', jsonStr)
          
          // 移除末尾可能的不完整内容
          jsonStr = jsonStr.replace(/,\s*$/, '') // 移除末尾的逗号
          jsonStr = jsonStr.replace(/:\s*$/, ': ""') // 补全缺少值的键
          jsonStr = jsonStr.replace(/,\s*}/, '}') // 移除对象末尾的逗号
          
          // 补全未闭合的引号
          const quotes = (jsonStr.match(/"/g) || []).length
          if (quotes % 2 !== 0) {
            jsonStr += '"'
          }
          
          // 补全未闭合的括号
          const openBraces = (jsonStr.match(/{/g) || []).length
          const closeBraces = (jsonStr.match(/}/g) || []).length
          if (openBraces > closeBraces) {
            jsonStr += '}'.repeat(openBraces - closeBraces)
          }
          
          try {
            params = JSON.parse(jsonStr)
          } catch (retryError) {
            console.error('Failed to parse action input after repair:', retryError)
            console.error('Original JSON:', inputMatch[1])
            console.error('Repaired JSON:', jsonStr)
            // 返回 null 而不是空对象，让调用方知道解析失败
            return null
          }
        }
      }

      return { tool, params }
    } catch (error) {
      console.error('Failed to parse action:', error)
      return null
    }
  }

  private async act(toolName: string, params: Record<string, any>): Promise<string> {
    const tool = getToolByName(toolName)
    
    if (!tool) {
      return `错误：未找到工具 "${toolName}"。请使用可用的工具列表中的工具。`
    }

    this.toolCallCounter++
    const toolCall: ToolCall = {
      id: `${Date.now()}-${this.toolCallCounter}-${Math.random().toString(36).substr(2, 9)}`,
      toolName,
      params,
      status: 'pending',
      timestamp: Date.now(),
    }

    this.config.onToolCall?.(toolCall)

    if (tool.requiresConfirmation && this.config.requestConfirmation) {
      const confirmed = await this.config.requestConfirmation(toolName, params)
      if (!confirmed) {
        toolCall.status = 'error'
        toolCall.result = {
          success: false,
          error: '用户取消了操作',
        }
        this.config.onToolCall?.(toolCall)
        return '用户取消了操作'
      }
    }

    toolCall.status = 'running'
    this.config.onToolCall?.(toolCall)

    try {
      const result: ToolResult = await tool.execute(params)
      
      toolCall.status = result.success ? 'success' : 'error'
      toolCall.result = result
      this.config.onToolCall?.(toolCall)

      if (result.success) {
        return result.message || `工具 ${toolName} 执行成功。${result.data ? `\n数据：${JSON.stringify(result.data, null, 2)}` : ''}`
      } else {
        return `工具 ${toolName} 执行失败：${result.error}`
      }
    } catch (error) {
      toolCall.status = 'error'
      toolCall.result = {
        success: false,
        error: String(error),
      }
      this.config.onToolCall?.(toolCall)
      return `工具 ${toolName} 执行出错：${error}`
    }
  }

  getSteps(): ReActStep[] {
    return this.steps
  }

  getCurrentIteration(): number {
    return this.currentIteration
  }
}
