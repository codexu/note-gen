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

  constructor(config: ReActConfig) {
    this.config = config
    if (!this.config.maxIterations) {
      this.config.maxIterations = 10
    }
  }

  async run(userInput: string, context?: string): Promise<string> {
    this.steps = []
    this.currentIteration = 0
    this.toolCallCounter = 0

    const systemPrompt = this.buildSystemPrompt()
    let finalAnswer = ''

    while (this.currentIteration < this.config.maxIterations) {
      this.currentIteration++

      // 在新迭代开始时，通知保存上一次的思考到历史
      if (this.currentIteration > 1) {
        this.config.onIterationStart?.()
      }

      const thought = await this.think(userInput, context, systemPrompt)

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
    
    return `你是一个智能助手 Agent，可以使用工具来帮助用户完成任务。你需要按照 ReAct (Reasoning + Acting) 框架来思考和行动。

## ReAct 框架说明

每次迭代包含三个步骤：
1. **Thought（思考）**：分析当前情况，决定下一步做什么
2. **Action（行动）**：选择一个工具并提供参数
3. **Observation（观察）**：系统会自动执行工具并返回结果

重复这个过程，直到你能给出最终答案。

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

1. **严格遵循格式**：每次回复必须包含 Thought，然后是 Action + Action Input 或 Final Answer
2. **JSON 格式**：Action Input 必须是有效的 JSON 对象，使用双引号
3. **一次一个工具**：每次只能调用一个工具，不要同时调用多个
4. **错误处理**：如果工具执行失败，分析原因并尝试其他方法
5. **任务完成**：当所有操作完成后，使用 Final Answer 给出清晰的总结
6. **只使用可用工具**：不要编造不存在的工具或参数
7. **确认危险操作**：删除、清空等操作会要求用户确认
8. **参数准确性**：确保传递正确的参数类型和值

## 工作流程示例

**用户请求**："帮我整理所有关于 React 的笔记"

**Iteration 1:**
\`\`\`
Thought: 首先需要搜索所有包含 React 的笔记
Action: search_notes
Action Input: {"query": "React"}
\`\`\`
Observation: 找到 5 条匹配的笔记

**Iteration 2:**
\`\`\`
Thought: 找到了 5 条笔记，现在我需要创建一个总结笔记来整理这些内容
Action: create_note
Action Input: {"tagId": 1, "content": "# React 知识总结\\n\\n整理了 5 条相关笔记...", "locale": "zh-CN"}
\`\`\`
Observation: 成功创建笔记，ID: 123

**Iteration 3:**
\`\`\`
Thought: 笔记已创建成功，任务完成
Final Answer: 已为您整理完成！创建了"React 知识总结"笔记，整合了 5 条相关内容。
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
      const inputMatch = thought.match(/Action Input:\s*({[\s\S]*?})/i)

      if (!actionMatch) return null

      const tool = actionMatch[1]
      const params = inputMatch ? JSON.parse(inputMatch[1]) : {}

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
