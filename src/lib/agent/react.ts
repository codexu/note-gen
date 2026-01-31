import { ReActStep, ToolCall, ToolResult } from './types'
import { getToolByName, getToolDescriptions } from './tools'
import { skillManager } from '@/lib/skills'

export interface ReActConfig {
  maxIterations: number
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onIterationStart?: () => void
  onSkillsSelected?: (skillIds: string[]) => void  // 当 AI 选择 Skills 时调用
  requestConfirmation?: (toolName: string, params: Record<string, any>) => Promise<boolean>
  activeSkills?: string[]  // 当前激活的 Skills
}

export class ReActAgent {
  private config: ReActConfig
  private steps: ReActStep[] = []
  private currentIteration = 0
  private toolCallCounter = 0
  private stopped = false
  private abortController: AbortController | null = null
  private selectedSkills: Set<string> = new Set() // 记录 AI 选择的 Skills

  constructor(config: ReActConfig) {
    this.config = config
    if (!this.config.maxIterations) {
      this.config.maxIterations = 15
    }
  }

  stop() {
    this.stopped = true
    // 终止所有正在进行的异步操作
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  isStopped(): boolean {
    return this.stopped
  }

  async run(userInput: string, context?: string, imageUrls?: string[]): Promise<string> {
    this.steps = []
    this.currentIteration = 0
    this.toolCallCounter = 0
    this.stopped = false
    this.selectedSkills.clear()
    // 创建新的 AbortController
    this.abortController = new AbortController()

    let finalAnswer = ''

    while (this.currentIteration < this.config.maxIterations) {
      // 检查是否已停止
      if (this.stopped) {
        // 返回特殊标记表示被用户终止，但保留已产生的步骤
        throw new Error('USER_STOPPED')
      }

      this.currentIteration++

      // 在新迭代开始时，通知保存上一次的思考到历史
      if (this.currentIteration > 1) {
        this.config.onIterationStart?.()
      }

      // 每次迭代都重新构建系统提示词，因为 Skills 指令依赖于当前迭代次数
      const systemPrompt = this.buildSystemPrompt()

      const thought = await this.think(userInput, context, systemPrompt, imageUrls)

      // 再次检查是否已停止
      if (this.stopped) {
        // 返回特殊标记表示被用户终止，但保留已产生的步骤
        throw new Error('USER_STOPPED')
      }

      // 检查是否包含 Final Answer（支持多种格式，包括换行的情况）
      // 处理 "Action: Final\nAnswer:" 的特殊情况
      const normalizedThought = thought.replace(/\s+/g, ' ')
      const hasFinalAnswer = normalizedThought.includes('Final Answer:') ||
                             normalizedThought.includes('Final Answer：') ||
                             normalizedThought.includes('最终答案') ||
                             /Action:\s*Final\s*Answer/i.test(thought)

      if (hasFinalAnswer) {
        // 尝试多种分割方式
        if (thought.includes('Final Answer:')) {
          finalAnswer = thought.split('Final Answer:')[1].trim()
        } else if (thought.includes('Final Answer：')) {
          finalAnswer = thought.split('Final Answer：')[1].trim()
        } else if (thought.includes('最终答案')) {
          finalAnswer = thought.split('最终答案')[1].trim()
        } else if (/Action:\s*Final\s*Answer/i.test(thought)) {
          // 处理 "Action: Final\nAnswer:" 的情况
          const match = thought.match(/Action:\s*Final\s*Answer:\s*([\s\S]*)/i)
          if (match) {
            finalAnswer = match[1].trim()
          }
        }
        break
      }

      // 检查是否是纯思考而没有 Action（说明 AI 认为任务已完成但忘记用 Final Answer 格式）
      if (!thought.includes('Action:') && thought.includes('Thought:') && this.currentIteration > 1) {
        // 如果只有 Thought 没有 Action，且这是第二次以后的迭代，可能是 AI 忘记格式
        // 将整个 thought 作为最终答案
        const thoughtContent = thought.replace(/Thought:\s*/i, '').trim()
        if (thoughtContent.length > 0 && !thoughtContent.includes('Action:')) {
          finalAnswer = thoughtContent
          break
        }
      }

      const action = this.parseAction(thought)
      if (!action) {
        finalAnswer = '抱歉，我无法理解如何执行这个任务。'
        break
      }

      // 检测重复操作
      const lastStep = this.steps[this.steps.length - 1]
      if (lastStep && lastStep.action) {
        // 检查是否是相同的工具和参数
        const isSameTool = lastStep.action.tool === action.tool
        const isSameParams = JSON.stringify(lastStep.action.params) === JSON.stringify(action.params)

        if (isSameTool && isSameParams) {
          // 检测到重复操作，给出警告并结束
          console.warn(`检测到重复操作: ${action.tool}`, action.params)
          finalAnswer = `操作已完成。${lastStep.observation}`
          break
        }

        // 检查是否连续多次执行完全相同的操作（超过 5 次且工具和参数都相同）
        // 只检查参数完全相同的情况，避免误判合法的批量操作
        let sameActionCount = 0
        for (let i = this.steps.length - 1; i >= 0; i--) {
          const step = this.steps[i]
          if (step.action && step.action.tool === action.tool) {
            const stepParamsSame = JSON.stringify(step.action.params) === JSON.stringify(action.params)
            if (stepParamsSame) {
              sameActionCount++
            } else {
              break
            }
          } else {
            break
          }
        }

        if (sameActionCount >= 5) {
          console.warn(`检测到连续多次执行相同操作: ${action.tool}, 次数: ${sameActionCount}`)
          finalAnswer = `检测到连续多次执行相同操作，已自动停止。最后操作结果：${lastStep.observation}`
          break
        }
      }

      this.config.onAction?.(action.tool, action.params)

      const observation = await this.act(action.tool, action.params, thought)

      // 检查是否已停止
      if (this.stopped) {
        // 返回特殊标记表示被用户终止，但保留已产生的步骤
        throw new Error('USER_STOPPED')
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
    const skillsInstructions = this.formatSkillsInstructions()

    let prompt = `你是一个高效的智能助手 Agent，使用工具帮助用户完成任务。遵循 ReAct 框架：Thought（思考）→ Action（行动）→ Observation（观察）。

## 🚨 重要警告：Skills 不是工具

**绝对不能使用以下格式**：
- ❌ Action: style-detector
- ❌ Action: skill_detector
- ❌ Action: any_skill_name

**Skills 只是指导文档，不是可调用的工具！**
- Skills 告诉你应该如何完成任务
- 你需要理解 Skill 的要求，然后使用**实际的工具**（如 create_markdown_file）来执行
- 例如：如果 style-detector 说要写网文，你应该 Action: create_markdown_file，在内容里写网文风格

## 核心原则

**效率优先**：尽量用最少的步骤完成任务，避免不必要的思考和操作。
**直接行动**：如果任务明确，直接执行，不要过度分析。
**快速结束**：完成核心任务后立即给出 Final Answer，不要重复执行相同的操作。

## 知识库检索说明

在"上下文信息"中，你可能看到"知识库检索结果"部分。请根据不同情况处理：

1. **找到相关内容**：优先使用检索到的笔记内容回答用户问题
2. **未找到相关内容**：
   - 如果用户询问具体笔记内容，请告知用户知识库中可能没有相关资料
   - 如果问题可以基于一般知识回答，请使用你的知识回答
   - 可以请用户提供更具体的关键词或问题
3. **检索出错**：请告知用户暂时无法访问知识库

## 可用工具

${toolDescriptions}`

    // 添加 Skills 指令
    if (skillsInstructions) {
      prompt += `

## 可用的 Skills

${skillsInstructions}`
    }

    prompt += `

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

### 格式 2：给出最终答案（重要：任务完成后必须使用此格式）
\`\`\`
Thought: 我已经完成了所有必要的操作，可以给出最终答案了
Final Answer: [完整的、对用户友好的最终答案]
\`\`\`

**示例：**
\`\`\`
Thought: 我已经成功创建了 React 知识总结笔记，任务完成
Final Answer: 已为您整理完成！我创建了一个名为"React 知识总结"的笔记，包含了 5 条相关笔记的内容整理。
\`\`\`

## ⚠️ 重要规则（必须遵守）

1. **严格格式**：Thought → Action + Action Input 或 Final Answer
2. **JSON 格式**：Action Input 必须是有效 JSON，使用双引号
3. **一次一个工具**：每次只调用一个工具
4. **立即结束**：完成核心任务后**必须**给出 Final Answer，不要做额外操作
5. **不要重复**：仔细观察 Observation，如果操作已经成功完成，立即给出 Final Answer，不要重复执行
6. **只用可用工具**：不要编造工具或参数，**绝对不要调用 Skill 名称作为工具**
7. **简洁思考**：Thought 保持简短，直接说明要做什么
8. **🚨 Skills 不是工具**：永远不要使用 Action: skill_xxx，Skills 只是指导文档

## 🚫 常见错误（避免）

❌ **错误1**：修改笔记后，又继续搜索或修改同一个笔记
✅ **正确**：修改笔记后直接给出 Final Answer

❌ **错误2**：搜索到结果后，又用相同条件搜索
✅ **正确**：搜索到结果后，根据结果执行操作，然后给出 Final Answer

❌ **错误3**：创建文件后，又继续创建相同或相似的文件
✅ **正确**：创建文件后，确认成功，立即给出 Final Answer

❌ **错误4**：试图调用 Skill 作为工具（如 Action: style-detector）
✅ **正确**：理解 Skill 的指导，使用实际工具（如 Action: create_markdown_file）并在内容中按 Skill 要求执行

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

    return prompt
  }

  private async think(userInput: string, context: string | undefined, systemPrompt: string, imageUrls?: string[]): Promise<string> {
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
      let lastUpdateLength = 0

      // 传递 AbortSignal 以支持终止，同时传递图片URL（仅在第一次迭代时）
      const imagesForThisIteration = this.currentIteration === 1 ? imageUrls : undefined
      await fetchAiStream(prompt, (content) => {
        // 检查是否已终止
        if (this.stopped) {
          return
        }

        response = content

        // 实时更新，但只在内容有实质性增长时更新（避免频繁更新）
        if (content.length - lastUpdateLength > 10 || content.includes('Action:') || content.includes('Final Answer:')) {
          this.config.onThought?.(content)
          lastUpdateLength = content.length
        }
      }, this.abortController?.signal, undefined, undefined, undefined, imagesForThisIteration)
      
      // 检查是否已终止
      if (this.stopped) {
        return `Thought: 用户终止了任务
Final Answer: 任务已被用户终止`
      }
      
      // 确保最终内容被更新
      if (response.length !== lastUpdateLength) {
        this.config.onThought?.(response)
      }

      // 记录 AI 的思考内容，用于调试
      const mentionedSkills = this.extractMentionedSkills(response)

      // 第一次迭代后，处理 Skills 选择
      if (this.currentIteration === 1) {
        const activeSkillIds = this.config.activeSkills || []
        const selectedSkillIds: string[] = []

        if (mentionedSkills.length > 0) {
          // 将提到的 Skills ID 添加到已选择集合
          for (const skillName of mentionedSkills) {
            // 通过名称查找对应的 Skill ID
            const skill = activeSkillIds
              .map(id => skillManager.getSkill(id))
              .filter((s): s is Exclude<typeof s, undefined> => s !== undefined)
              .find(s => s.metadata.name === skillName)

            if (skill) {
              this.selectedSkills.add(skill.metadata.id)
              selectedSkillIds.push(skill.metadata.id)
            }
          }
        }

        // 无论是否选择了 Skills，都要通知外部（空数组表示未选择）
        this.config.onSkillsSelected?.(selectedSkillIds)
      }

      return response
    } catch (error) {
      // 检查是否是因为终止导致的错误
      if (this.stopped || (error instanceof Error && error.name === 'AbortError')) {
        return `Thought: 用户终止了任务
Final Answer: 任务已被用户终止`
      }
      
      console.error('LLM API call failed:', error)
      // 如果 API 调用失败，返回错误提示
      return `Thought: 抱歉，AI 服务暂时不可用
Final Answer: 无法完成任务，请稍后重试或检查 AI 配置`
    }
  }

  private parseAction(thought: string): { tool: string; params: Record<string, any> } | null {
    try {
      // 首先检查是否包含 Final Answer - 如果是，返回 null
      // 需要处理换行的情况，如 "Action: Final\nAnswer: ..."
      const normalizedThought = thought.replace(/\s+/g, ' ')
      if (normalizedThought.includes('Final Answer:') ||
          normalizedThought.includes('Final Answer：') ||
          normalizedThought.includes('最终答案') ||
          // 处理 "Action: Final\nAnswer:" 的情况
          /Action:\s*Final\s*Answer/i.test(thought)) {
        return null
      }

      // 修改正则表达式，支持工具名称中的连字符、下划线等字符
      const actionMatch = thought.match(/Action:\s*([a-zA-Z0-9_-]+)/i)

      if (!actionMatch) return null

      const tool = actionMatch[1]
      let params = {}
      
      // 使用更宽松的正则匹配，获取 Action Input 后的所有内容
      const inputMatch = thought.match(/Action Input:\s*({[\s\S]*)/i)
      
      if (inputMatch) {
        let jsonStr = inputMatch[1].trim()
        
        // 移除可能的标记符号（如 <|begin_of_box|> 和 <|end_of_box|>）
        jsonStr = jsonStr.replace(/<\|begin_of_box\|>/g, '').replace(/<\|end_of_box\|>/g, '').trim()
        
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

  private async act(toolName: string, params: Record<string, any>, thought?: string): Promise<string> {
    const tool = getToolByName(toolName)

    if (!tool) {
      return `错误：未找到工具 "${toolName}"。请使用可用的工具列表中的工具。`
    }

    this.toolCallCounter++
    const toolCall: ToolCall = {
      id: `${Date.now()}-${this.toolCallCounter}-${Math.random().toString(36).substring(2, 11)}`,
      toolName,
      params,
      status: 'pending',
      timestamp: Date.now(),
    }

    // 查找哪个 Skill 授权了这个工具
    const authorizingSkills: string[] = []
    if (this.config.activeSkills && this.config.activeSkills.length > 0) {
      for (const skillId of this.config.activeSkills) {
        const skill = skillManager.getSkill(skillId)
        // 移除 enabled 判断，只要 Skill 存在就检查授权
        if (skill && skill.metadata.allowedTools?.includes(toolName)) {
          authorizingSkills.push(skill.metadata.name)
        }
      }
    }

    this.config.onToolCall?.(toolCall)

    // 检查工具是否在当前激活的 Skills 中被授权
    const isAuthorized = this.isToolAuthorized(toolName)
    const requiresConfirmation = tool.requiresConfirmation && !isAuthorized

    if (requiresConfirmation && this.config.requestConfirmation) {
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
        // 特殊处理 select_skill 工具
        if (toolName === 'select_skill' && result.data?.selected_skills) {
          const selectedSkillIds: string[] = result.data.selected_skills

          // 更新 selectedSkills
          for (const skillId of selectedSkillIds) {
            this.selectedSkills.add(skillId)
          }

          // 通知外部选择的 Skills
          this.config.onSkillsSelected?.(selectedSkillIds)
        }

        let observation = result.message || `工具 ${toolName} 执行成功。`

        // 如果有数据，根据数据类型进行格式化
        if (result.data) {
          // 特殊处理 MCP 搜索结果（category 为 'mcp' 的工具）
          if (tool.category === 'mcp') {
            // 从思考内容中提取简短标题
            const shortTitle = thought ? this.extractTitleFromThought(thought) : tool.description
            observation = this.formatMcpResult(shortTitle, result.data)
          } else if (Array.isArray(result.data)) {
            if (result.data.length > 0) {
              observation += `\n\n数据详情：\n${JSON.stringify(result.data, null, 2)}`
            }
          } else {
            // 对于对象数据，也格式化显示
            observation += `\n\n数据详情：\n${JSON.stringify(result.data, null, 2)}`
          }
        }

        return observation
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

  /**
   * 从思考内容中提取简短标题
   */
  private extractTitleFromThought(thought: string): string {
    // 移除 "Thought:" 前缀
    const content = thought.replace(/^Thought:\s*/i, '').trim()

    // 提取第一句话或前50个字符
    const firstSentence = content.split(/[。！？.!?]/)[0]
    if (firstSentence && firstSentence.length > 0 && firstSentence.length < 100) {
      return firstSentence.trim()
    }

    // 如果第一句话太长或没有句子结束符，截取前50个字符
    if (content.length > 50) {
      return content.substring(0, 50) + '...'
    }

    return content
  }

  /**
   * 格式化 MCP 工具的返回结果
   */
  private formatMcpResult(toolDescription: string, data: any): string {
    // 处理搜索结果
    if (data.results && Array.isArray(data.results)) {
      const results = data.results
      let formatted = `MCP: ${toolDescription}，找到 ${results.length} 条结果：\n\n`

      results.forEach((item: any, index: number) => {
        formatted += `${index + 1}. ${item.title || '无标题'}\n`
        formatted += `   ${item.snippet || item.description || '无描述'}\n`
        formatted += `   UUID: ${item.uuid}\n`
        if (item.url) {
          formatted += `   URL: ${item.url}\n`
        }
        formatted += '\n'
      })

      return formatted
    }

    // 处理网页抓取结果
    if (data.content && typeof data.content === 'string') {
      return `MCP: ${toolDescription}：\n\n${data.content}`
    }

    // 其他情况使用 JSON 格式化
    return `MCP: ${toolDescription}\n\n返回结果：\n${JSON.stringify(data, null, 2)}`
  }

  getSteps(): ReActStep[] {
    return this.steps
  }

  getCurrentIteration(): number {
    return this.currentIteration
  }

  /**
   * 格式化 Skills 指令为系统提示
   * 只发送元数据和简要说明，完整指令由 AI 根据描述理解并执行
   */
  private formatSkillsInstructions(): string {
    const activeSkillIds = this.config.activeSkills
    if (!activeSkillIds || activeSkillIds.length === 0) {
      return ''
    }

    // 第一次迭代：只发送 Skills 的简要信息（名称和描述），让 AI 选择
    if (this.currentIteration === 1) {
      const skillsList: string[] = []
      const skillsDebugInfo: any[] = []

      for (const skillId of activeSkillIds) {
        const skill = skillManager.getSkill(skillId)
        if (!skill) {
          continue
        }

        // 只发送简要信息
        let skillText = `### ${skill.metadata.name}\n\n`
        skillText += `- 描述：${skill.metadata.description}\n`
        skillText += `- ID：${skill.metadata.id}\n\n`

        skillsList.push(skillText)
        skillsDebugInfo.push({
          id: skill.metadata.id,
          name: skill.metadata.name,
          description: skill.metadata.description
        })
      }

      if (skillsList.length === 0) {
        return ''
      }

      const result = `## 可用的 Skills

**第一步：使用 select_skill 工具选择合适的 Skill**

请根据用户任务，从以下 Skills 中选择最相关的一个或多个：

${skillsList.join('\n---\n\n')}

**🚨 必须使用工具来选择 Skill！**

正确的选择 Skill 方式：
\`\`\`
Thought: 用户要求写网文，我需要选择 style-detector Skill 来指导写作风格。
Action: select_skill
Action Input: {"skill_ids": ["style-detector"]}
\`\`\`

选择 Skill 后，你将在下一个迭代中收到该 Skill 的完整指令。然后你可以使用实际的工具（如 create_markdown_file）来完成任务。

**重要说明**：
- 仔细阅读每个 Skill 的描述
- 使用 \`select_skill\` 工具来选择 Skill
- 在 Action Input 中传入 Skill ID 数组（例如：["style-detector", "weekly"]）
- 选择后等待下一个迭代，Skill 的完整指令会提供给你
- 永远不要直接使用 Skill 名称作为 Action`

      return result
    }

    // 后续迭代：只发送已选择的 Skills 的完整内容
    if (this.selectedSkills.size === 0) {
      return ''
    }

    const skillsList: string[] = []
    const skillsDebugInfo: any[] = []

    for (const skillId of this.selectedSkills) {
      const skill = skillManager.getSkill(skillId)
      if (!skill) {
        continue
      }

      // 发送完整的 Skill 信息
      let skillText = `### ${skill.metadata.name}\n\n`

      // YAML 元数据部分
      skillText += `**元数据**：\n`
      skillText += `- 描述：${skill.metadata.description}\n`
      skillText += `- 版本：${skill.metadata.version}\n`
      if (skill.metadata.author) {
        skillText += `- 作者：${skill.metadata.author}\n`
      }
      if (skill.metadata.allowedTools && skill.metadata.allowedTools.length > 0) {
        skillText += `- 授权工具：${skill.metadata.allowedTools.join(', ')}\n`
      }
      skillText += `\n`

      // 完整指令部分（Markdown 内容）
      skillText += `**执行指令**：\n${skill.instructions}\n\n`

      skillsList.push(skillText)

      // 收集调试信息
      skillsDebugInfo.push({
        id: skill.metadata.id,
        name: skill.metadata.name,
        description: skill.metadata.description,
        instructionLength: skill.instructions.length
      })
    }

    if (skillsList.length === 0) {
      return ''
    }

    const result = `## 已选择的 Skills

你选择了以下 Skills 来指导当前任务：

${skillsList.join('\n---\n\n')}

**📋 如何使用这些 Skills**：

1. **仔细阅读上述 Skills 的完整指令**
2. **理解 Skills 的要求后，直接应用到你的工作中**
3. **不要询问用户确认** - 直接按照 Skills 的指导执行任务
4. **不要尝试读取额外的文件** - Skills 已包含所有必要信息
5. **使用实际工具完成任务** - 如 create_markdown_file, modify_current_note 等

**⚠️ 重要提醒**：
- 严格按照上述 Skills 的要求执行任务
- 不要尝试调用 Skill 作为工具
- 不要询问用户风格选择 - 直接应用最相关的风格
- 如果是 style-detector Skill，直接应用对应风格（如网文风格）到你的内容中`

    return result
  }

  /**
   * 从思考内容中提取提到的 Skills
   */
  private extractMentionedSkills(thought: string): string[] {
    const mentioned: string[] = []
    if (!this.config.activeSkills || this.config.activeSkills.length === 0) {
      return mentioned
    }

    for (const skillId of this.config.activeSkills) {
      const skill = skillManager.getSkill(skillId)
      if (skill) {
        // 检查是否提到了 Skill 的名称或描述中的关键词
        const skillName = skill.metadata.name.toLowerCase()
        const keywords = [
          skillName,
          ...skill.metadata.name.split(/\s+/),
          ...skill.metadata.description.toLowerCase().split(/\s+/).filter(w => w.length > 3)
        ]

        const thoughtLower = thought.toLowerCase()
        if (keywords.some(keyword => thoughtLower.includes(keyword))) {
          mentioned.push(skill.metadata.name)
        }
      }
    }

    return mentioned
  }

  /**
   * 检查工具是否在当前激活的 Skills 中被授权（移除 enabled 判断）
   */
  isToolAuthorized(toolName: string): boolean {
    const activeSkillIds = this.config.activeSkills
    if (!activeSkillIds || activeSkillIds.length === 0) {
      return false
    }

    for (const skillId of activeSkillIds) {
      const skill = skillManager.getSkill(skillId)
      // 移除 enabled 判断，只要 Skill 存在且授权了工具就返回 true
      if (skill && skill.metadata.allowedTools?.includes(toolName)) {
        return true
      }
    }

    return false
  }
}
