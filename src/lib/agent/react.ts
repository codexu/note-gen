import { ReActStep, ToolCall, ToolResult } from './types'
import { getToolByName, getToolDescriptions } from './tools'
import { skillManager } from '@/lib/skills'
import OpenAI from 'openai'

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

  async run(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[]
  ): Promise<string> {
    this.steps = []
    this.currentIteration = 0
    this.toolCallCounter = 0
    this.stopped = false
    this.selectedSkills.clear()
    // 创建新的 AbortController
    this.abortController = new AbortController()

    let finalAnswer = ''

    // 检测 contextOrMessages 的类型
    const isMessagesArray = Array.isArray(contextOrMessages)
    const contextString = isMessagesArray ? undefined : contextOrMessages as string | undefined
    const messagesArray = isMessagesArray ? contextOrMessages as OpenAI.Chat.ChatCompletionMessageParam[] : undefined

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
      const systemPrompt = await this.buildSystemPrompt()

      const thought = await this.think(userInput, contextString, messagesArray, systemPrompt, imageUrls)

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
        // 无法解析 Action，尝试从 thought 中提取答案
        // 检查是否 AI 想直接回答但忘记使用 Final Answer 格式
        const thoughtContent = thought.replace(/Thought:\s*/i, '').trim()
        if (thoughtContent && thoughtContent.length > 10 && !thoughtContent.includes('Action:')) {
          // 看起来 AI 想直接回答，提取内容作为答案
          finalAnswer = thoughtContent
          break
        }

        // 如果是第一次迭代，可能是 AI 没理解用户意图
        // 尝试让 AI 直接回答而不是调用工具
        if (this.currentIteration === 1) {
          finalAnswer = thoughtContent || '抱歉，我不太理解您的需求。您能详细说明一下吗？'
          break
        }

        // 多次迭代后仍然失败，给出提示
        finalAnswer = thoughtContent || '抱歉，我遇到了一些问题。您能换种方式说明一下您的需求吗？'
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

  private async buildSystemPrompt(): Promise<string> {
    const toolDescriptions = getToolDescriptions()
    const skillsInstructions = this.formatSkillsInstructions()

    // Load user memories (preferences and knowledge)
    let memoryPrompt = ''
    try {
      const { contextLoader } = await import('@/lib/context/loader')
      // Get all memories (preferences are always included, knowledge is matched by similarity)
      const memoryContext = await contextLoader.getContextForQuery('')  // Empty query gets all preferences
      if (memoryContext.preferences.length > 0 || memoryContext.memory.length > 0) {
        memoryPrompt = contextLoader.formatMemoriesForPrompt(memoryContext)
        console.log('[Agent] Loaded memories:', memoryContext)
      }
    } catch (error) {
      console.error('[Agent] Failed to load memories:', error)
    }

    let prompt = `You are an efficient AI agent that uses tools to help users complete tasks. Follow the ReAct framework: Thought → Action → Observation.

${memoryPrompt ? `## User Memories\n\n${memoryPrompt}\n` : ''}

## 🚨 Important Warning: Skills Are Not Tools

**You must NEVER use these formats:**
- ❌ Action: style-detector
- ❌ Action: skill_detector
- ❌ Action: any_skill_name

**Skills are guidance documents, NOT callable tools!**
- Skills tell you HOW to complete tasks
- You need to understand Skill requirements, then use **actual tools** (like create_markdown_file) to execute
- Example: if style-detector says to write web fiction, you should Action: create_markdown_file and write in web fiction style in the content

## Core Principles

**Intent First**: Before using any tool, carefully analyze user's intent:
- **Is the user asking a question?** → Give direct answer with Final Answer
- **Is the user requesting information?** → Search/read relevant notes, then answer
- **Is the user explicitly requesting an action?** (create, modify, delete) → Then use tools
- **Are you unsure about user's intent?** → Ask clarifying question, don't assume

**Efficiency**: Complete tasks with minimum steps, avoid unnecessary tool calls.
**Direct Action**: If intent is clear and action is needed, execute without over-analysis.
**Quick Finish**: Give Final Answer immediately after completing task, don't repeat operations.

## Knowledge Base Search Guide

In the "context information", you may see "Knowledge Base Search Results" section. This is from **automatic RAG search**.

**If automatic search results are insufficient**, you can actively call search tools for more precise retrieval:

Search tool selection guide:
- search_markdown_files (default mode): Exact keyword search, like "useState", "React Hooks", "API config"
- search_markdown_files + mode=rag: Semantic search for exploratory queries, like "how to optimize performance", "sync problem solutions"
- Add folderPath parameter: Limit search scope to specific folder, like only search in "Tech/React" folder

Important tips:
- When automatic RAG results are limited, use mode=rag for deeper semantic search
- For exact terms, default mode (keyword search) is faster and more accurate
- If results are insufficient, try different query formulations or limit folder scope

## Available Tools

${toolDescriptions}`

    // Add Skills instructions
    if (skillsInstructions) {
      prompt += `

## Available Skills

${skillsInstructions}`
    }

    prompt += `

## Output Format Requirements

Your every response **MUST strictly follow** one of these formats:

### Format 1: Think and Execute Tool
\`\`\`
Thought: [Detailed thinking process explaining why to execute this operation]
Action: tool_name
Action Input: {"param1": "value1", "param2": "value2"}
\`\`\`

**Example:**
\`\`\`
Thought: User wants to organize React notes, I need to search for all notes containing React keyword
Action: search_notes
Action Input: {"query": "React"}
\`\`\`

### Format 2: Give Final Answer (IMPORTANT: Must use this format after task completion)
\`\`\`
Thought: I have completed all necessary operations, ready to give final answer
Final Answer: [Complete, user-friendly final answer]
\`\`\`

**Example:**
\`\`\`
Thought: I have successfully created React knowledge summary note, task completed
Final Answer: Done! I created a note called "React Knowledge Summary" which includes organized content from 5 related notes.
\`\`\`

## ⚠️ Important Rules (Must Follow)

**🎯 Intent Judgment (CRITICAL)**:
- If user is **asking a question** (What is...? How do I...? Tell me about...?) → Give Final Answer directly
- If user is **requesting information** (Find..., Show me..., List...) → Use search/read tools, then answer
- If user is **requesting an action** (Create..., Modify..., Delete..., Make...) → Use action tools
- If **uncertain about intent** → Ask clarifying question in Final Answer format
- **NEVER assume** user wants creation/modification when they're just asking or discussing

**Technical Rules**:
1. **Strict Format**: Thought → Action + Action Input or Final Answer
2. **JSON Format**: Action Input must be valid JSON with double quotes
3. **One Tool at a Time**: Only call one tool per iteration
4. **Finish Immediately**: **MUST** give Final Answer after completing task, no extra operations
5. **Don't Repeat**: If operation succeeded, immediately give Final Answer
6. **Use Available Tools Only**: Don't make up tools or parameters
7. **Concise Thinking**: Keep Thought brief, directly state what to do
8. **🚨 Skills Are Not Tools**: NEVER use Action: skill_xxx, Skills are just guidance documents

## 🚫 Common Errors (Avoid)

❌ **Error 1**: After modifying a note, continue searching or modifying the same note
✅ **Correct**: After modifying note, directly give Final Answer

❌ **Error 2**: After getting search results, search again with same conditions
✅ **Correct**: After getting search results, execute operations based on results, then give Final Answer

❌ **Error 3**: After creating a file, continue creating same or similar files
✅ **Correct**: After creating file, confirm success and immediately give Final Answer

❌ **Error 4**: Try to call Skill as a tool (like Action: style-detector)
✅ **Correct**: Understand Skill guidance, use actual tools (like Action: create_markdown_file) and follow Skill requirements in content

## Example

**Example 1: User asking a question (NO TOOL NEEDED)**

**User**: "What is React?"

**Iteration 1:**
\`\`\`
Thought: User is asking for information about React. This is a question, not a request to create content. I should answer directly.
Final Answer: React is a JavaScript library for building user interfaces, developed by Facebook. It uses a component-based architecture and virtual DOM for efficient rendering.
\`\`\`

**Example 2: User requesting creation (USE TOOL)**

**User**: "Create a note introducing NoteGen"

**Iteration 1:**
\`\`\`
Thought: User explicitly requested to create a note. I will use the create_markdown_file tool.
Action: create_markdown_file
Action Input: {"fileName": "NoteGen-Intro.md", "content": "# NoteGen\\n\\nAn intelligent note-taking software..."}
\`\`\`
Observation: File created successfully

**Iteration 2:**
\`\`\`
Thought: Task completed
Final Answer: Created note "NoteGen-Intro.md"
\`\`\`

**Example 3: User requesting information (USE SEARCH TOOL)**

**User**: "Find notes about React hooks"

**Iteration 1:**
\`\`\`
Thought: User wants to find information about React hooks from existing notes. I should search for relevant notes.
Action: search_markdown_files
Action Input: {"query": "React hooks"}
\`\`\`
Observation: Found 3 notes about React hooks...

**Iteration 2:**
\`\`\`
Thought: I found relevant information. Now I can answer the user's question.
Final Answer: I found 3 notes about React hooks: [summary of findings]
\`\`\`

Now start executing the task!`

    return prompt
  }

  private async think(
    userInput: string,
    context: string | undefined,
    messages: OpenAI.Chat.ChatCompletionMessageParam[] | undefined,
    systemPrompt: string,
    imageUrls?: string[]
  ): Promise<string> {
    const historyContext = this.steps.map((step, i) =>
      `Iteration ${i + 1}:
Thought: ${step.thought}
Action: ${step.action?.tool}
Action Input: ${JSON.stringify(step.action?.params)}
Observation: ${step.observation}
`
    ).join('\n')

    // If messages array is provided, use it; otherwise use old string concatenation
    if (messages && messages.length > 0) {
      // Use messages array mode - build messages and add user request
      const messagesForAI: OpenAI.Chat.ChatCompletionMessageParam[] = []

      // Add system prompt (if any)
      if (systemPrompt) {
        messagesForAI.push({
          role: 'system',
          content: systemPrompt
        })
      }

      // Add conversation history
      messagesForAI.push(...messages)

      // Add current iteration context (ReAct step history)
      if (historyContext) {
        messagesForAI.push({
          role: 'system',
          content: `## Previous Iterations\n${historyContext}`
        })
      }

      // Add user request
      messagesForAI.push({
        role: 'user',
        content: `This is iteration ${this.currentIteration}, please give your Thought and Action (or Final Answer):\n\nUser Request: ${userInput}`
      })

      // 调用实际的 LLM API
      try {
        const { fetchAiStream } = await import('@/lib/ai')
        let response = ''
        let lastUpdateLength = 0

        // 传递 AbortSignal 以支持终止，同时传递图片URL（仅在第一次迭代时）
        const imagesForThisIteration = this.currentIteration === 1 ? imageUrls : undefined
        await fetchAiStream('', (content) => {
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
        }, this.abortController?.signal, undefined, undefined, undefined, imagesForThisIteration, undefined, messagesForAI)

        // 检查是否已终止
        if (this.stopped) {
          return `Thought: User terminated the task
Final Answer: Task was terminated by user`
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
          return `Thought: User terminated the task
Final Answer: Task was terminated by user`
        }

        console.error('LLM API call failed:', error)
        // 如果 API 调用失败，返回错误提示
        return `Thought: Sorry, AI service is temporarily unavailable
Final Answer: Unable to complete task, please retry later or check AI configuration`
      }
    }

    // 旧的字符串拼接模式（向后兼容）
    const prompt = `${systemPrompt}

${context ? `## 上下文信息\n${context}\n` : ''}

## 对话历史
${historyContext}

## User Request
${userInput}

This is iteration ${this.currentIteration}, please give your Thought and Action (or Final Answer):`

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

    // First iteration: only send brief info (name and description), let AI choose
    if (this.currentIteration === 1) {
      const skillsList: string[] = []
      const skillsDebugInfo: any[] = []

      for (const skillId of activeSkillIds) {
        const skill = skillManager.getSkill(skillId)
        if (!skill) {
          continue
        }

        // Only send brief information
        let skillText = `### ${skill.metadata.name}\n\n`
        skillText += `- Description: ${skill.metadata.description}\n`
        skillText += `- ID: ${skill.metadata.id}\n\n`

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

      const result = `## Available Skills

**Step 1: Use select_skill tool to choose appropriate Skill**

Please select the most relevant skill(s) from the following based on user task:

${skillsList.join('\n---\n\n')}

**🚨 You MUST use tool to select Skill!**

Correct way to select Skill:
\`\`\`
Thought: User wants to write web fiction, I need to select style-detector Skill to guide writing style.
Action: select_skill
Action Input: {"skill_ids": ["style-detector"]}
\`\`\`

After selecting Skill, you will receive complete Skill instructions in next iteration. Then you can use actual tools (like create_markdown_file) to complete the task.

**Important Notes**:
- Carefully read each Skill's description
- Use \`select_skill\` tool to select Skill
- Pass Skill ID array in Action Input (e.g.: ["style-detector", "weekly"])
- After selection, wait for next iteration, complete Skill instructions will be provided
- NEVER use Skill name directly as Action`

      return result
    }

    // Subsequent iterations: only send complete content of selected Skills
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

      // Send complete Skill information
      let skillText = `### ${skill.metadata.name}\n\n`

      // YAML metadata section
      skillText += `**Metadata**:\n`
      skillText += `- Description: ${skill.metadata.description}\n`
      skillText += `- Version: ${skill.metadata.version}\n`
      if (skill.metadata.author) {
        skillText += `- Author: ${skill.metadata.author}\n`
      }
      if (skill.metadata.allowedTools && skill.metadata.allowedTools.length > 0) {
        skillText += `- Authorized Tools: ${skill.metadata.allowedTools.join(', ')}\n`
      }
      skillText += `\n`

      // Complete instructions section (Markdown content)
      skillText += `**Instructions**:\n${skill.instructions}\n\n`

      skillsList.push(skillText)

      // Collect debug info
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

    const result = `## Selected Skills

You selected the following Skills to guide current task:

${skillsList.join('\n---\n\n')}

**📋 How to use these Skills**:

1. **Carefully read complete instructions of above Skills**
2. **Understand Skill requirements, then apply directly to your work**
3. **Don't ask user for confirmation** - Execute tasks directly following Skill guidance
4. **Don't try to read additional files** - Skills already contain all necessary information
5. **Use actual tools to complete tasks** - Like create_markdown_file, modify_current_note, etc.

**⚠️ Important Reminders**:
- Strictly follow above Skill requirements to execute tasks
- Don't try to call Skill as a tool
- Don't ask user for style selection - directly apply most relevant style
- If it's style-detector Skill, directly apply corresponding style (like web fiction style) to your content`

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
