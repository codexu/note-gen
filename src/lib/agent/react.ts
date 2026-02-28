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
  onFinalAnswerRender?: (markdownContent: string) => void  // 当检测到 Final Answer 时立即渲染 Markdown
  requestConfirmation?: (toolName: string, params: Record<string, any>, context?: {
    originalContent?: string
    modifiedContent?: string
    filePath?: string
  }) => Promise<boolean>
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
        // 直接提取 Final Answer 后面的内容作为 Markdown 格式返回
        if (thought.includes('Final Answer:')) {
          finalAnswer = thought.split('Final Answer:')[1].trim()
        } else if (thought.includes('Final Answer：')) {
          finalAnswer = thought.split('Final Answer：')[1].trim()
        } else if (thought.includes('最终答案')) {
          finalAnswer = thought.split('最终答案')[1].trim()
        } else if (/Action:\s*Final\s*Answer:\s*([\s\S]*)/i.test(thought)) {
          // 处理 "Action: Final\nAnswer:" 的情况
          const match = thought.match(/Action:\s*Final\s*Answer:\s*([\s\S]*)/i)
          if (match) {
            finalAnswer = match[1].trim()
          }
        } else if (/Final Answer:\s*([\s\S]*)/i.test(thought)) {
          // 处理 "Final Answer:\n..." 多行内容的情况
          const match = thought.match(/Final Answer:\s*([\s\S]*)/i)
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
- You need to understand Skill requirements, then use **actual tools** (like create_file) to execute
- Example: if style-detector says to write web fiction, you should Action: create_file and write in web fiction style in the content

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
- search_markdown_files: Use when user asks to search files (default: keyword mode, rag: semantic mode)
- search_markdown_files + folderPath: Limit scope to specific folder
- search_marks: Search database records under tags

Important tips:
- Only call search tools when user explicitly requests to search/查找/搜索

## 🚨 Critical: Understanding Notes vs Tags vs Marks

Before using any tools, you MUST understand the difference between these three core concepts:

### 1. **Notes (笔记)** - File System Resources
- **What**: Markdown (.md) files in the file manager
- **Storage**: Local file system (custom workspace or default article directory)
- **How to identify**: Tool names contain "markdown_file" (e.g., "read_markdown_file", "list_markdown_files")
- **When to use**: User mentions "notes", "files", "documents", or wants to read/write organized content
- **Key distinction**: These are **files** with paths like "folder/note.md"

### 2. **Tags (标签)** - Organization Categories
- **What**: Grouping labels to organize marks/records
- **Storage**: SQLite database
- **How to identify**: Tool names contain "_tag" (e.g., "list_tags", "create_tag")
- **Purpose**: Categorize and organize marks; each tag can contain multiple marks
- **Key distinction**: Tags are **categories**, NOT content themselves

### 3. **Marks (记录)** - Content Records Under Tags
- **What**: Individual content records stored under a specific tag
- **Storage**: SQLite database (each mark belongs to one tag via tagId)
- **How to identify**: Tool names contain "_mark" (e.g., "read_marks", "create_mark", "search_marks")
- **Types**: scan, text, image, link, file, recording, todo
- **Key distinction**: Marks are **content items** like bookmarks, captured text, OCR results, etc.

### Decision Guide:
| User Request | Concept | Tools to Use |
|--------------|---------|--------------|
| "List my notes" / "Read note files" | Note (file) | list_markdown_files, read_markdown_file |
| "Create a new note file" | Note (file) | create_file |
| "Find/create tags" | Tag | list_tags, create_tag |
| "List records in inbox" / "Create a bookmark" | Mark | read_marks, create_mark |
| "Search my captures" / "Find saved content" | Mark | search_marks |

**IMPORTANT**: Never confuse these concepts! Tags organize Marks, but Tags and Marks are NOT the same as Notes (files).

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

**🔍 Search Tools Usage**:
- Only use search_markdown_files when user explicitly asks to search (e.g., "搜索", "查找", "帮我找")
- NEVER use search tools when user is just asking a question without requesting search
- For RAG mode (semantic search): only use when user explicitly asks for "语义搜索" or "AI搜索"

**Technical Rules**:
1. **Strict Format**: Thought → Action + Action Input or Final Answer
2. **JSON Format**: Action Input must be valid JSON with double quotes
3. **One Tool at a Time**: Only call one tool per iteration
4. **✅ TASK COMPLETION (CRITICAL)**: After any successful tool execution, you MUST give Final Answer immediately - do NOT repeat the same or similar operations
5. **Don't Repeat**: If operation succeeded, immediately give Final Answer - never create the same file twice or perform redundant actions
6. **Use Available Tools Only**: Don't make up tools or parameters
7. **Concise Thinking**: Keep Thought brief, directly state what to do
8. **🚨 Skills Are Not Tools**: NEVER use Action: skill_xxx, Skills are just guidance documents
9. **📌 Use Quote Line Numbers**: When context includes "quoted content" with VALID line numbers (positive integers, NOT -1), ALWAYS use replace_editor_content with line-based mode (startLine/endLine). If line numbers are -1 or invalid, first use get_editor_selection to get valid line numbers. NEVER use from/to or searchContent.
10. **📝 State-Based Reasoning**: Base your next action on the PREVIOUS observation result, not on the original user request - the context shows what you just did and the result

## 🚫 Common Errors (Avoid)

❌ **Error 1**: After modifying a note, continue searching or modifying the same note
✅ **Correct**: After modifying note, directly give Final Answer

❌ **Error 2**: After getting search results, search again with same conditions
✅ **Correct**: After getting search results, execute operations based on results, then give Final Answer

❌ **Error 3**: After creating a file, try to create another similar file (redundant creation)
✅ **Correct**: After creating file, confirm success and immediately give Final Answer

❌ **Error 4**: Try to call Skill as a tool (like Action: style-detector)
✅ **Correct**: Understand Skill guidance, use actual tools (like Action: create_file) and follow Skill requirements in content

❌ **Error 5**: Use invalid line numbers (e.g., -1) or use from/to/searchContent when valid positive line numbers are available
✅ **Correct**: Only use line-based mode with VALID positive line numbers. If line numbers are -1 or invalid, first call get_editor_selection to get valid line numbers, then use replace_editor_content with those line numbers

❌ **Error 6**: Ignore the previous operation result and repeat the same action
✅ **Correct**: Always base your next action on the PREVIOUS observation result - if the result shows success, give Final Answer immediately

❌ **Error 7**: Reconsider the original user request in every iteration instead of building on previous results
✅ **Correct**: Focus on the PREVIOUS step's result - the context shows what you just did and what happened

❌ **Error 8**: Use search tools when user is just asking a question without explicitly requesting search
✅ **Correct**: Only use search_markdown_files when user explicitly says "搜索", "查找", "帮我找". For regular questions like "What is React?", give Final Answer directly without searching

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
Thought: User explicitly requested to create a note. I will use the create_file tool.
Action: create_file
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

      // 【关键修改】按照 LangChain 最佳实践：
      // 第一次迭代：发送原始用户请求
      // 后续迭代：只发送上一步操作的结果，不再重复发送原始请求
      if (this.currentIteration === 1) {
        messagesForAI.push({
          role: 'user',
          content: `This is iteration ${this.currentIteration}, please give your Thought and Action (or Final Answer):\n\nUser Request: ${userInput}`
        })
      } else {
        // 后续迭代：只发送上一步的结果
        const lastStep = this.steps[this.steps.length - 1]
        const lastObservation = lastStep?.observation || 'No previous result'
        messagesForAI.push({
          role: 'user',
          content: `## Previous Step Result\n${lastObservation}\n\n---\nIf the task is completed, respond with Final Answer.\nIf you need to continue, provide your next Thought and Action.`
        })
      }

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

          // 检测是否包含 Final Answer，提取内容并渲染 Markdown
          const extractedFinalAnswer = this.extractFinalAnswer(content)
          if (extractedFinalAnswer) {
            // 包含 Final Answer，立即渲染 Markdown
            this.config.onFinalAnswerRender?.(extractedFinalAnswer)
          }

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
    // 【关键修改】按照 LangChain 最佳实践：
    // 第一次迭代：发送完整请求
    // 后续迭代：只发送上一步结果，不再重复发送原始请求
    let prompt: string
    if (this.currentIteration === 1) {
      prompt = `${systemPrompt}

${context ? `## 上下文信息\n${context}\n` : ''}

## 对话历史
${historyContext}

## User Request
${userInput}

This is iteration ${this.currentIteration}, please give your Thought and Action (or Final Answer):`
    } else {
      // 后续迭代：只发送上一步的结果
      const lastStep = this.steps[this.steps.length - 1]
      const lastObservation = lastStep?.observation || '无'
      prompt = `${systemPrompt}

## 已完成的步骤
${historyContext}

## 上一步操作结果
${lastObservation}

---
如果任务已完成，请回复 Final Answer。
如果需要继续操作，请提供你的 Thought 和 Action。`
    }

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

        // 检测是否包含 Final Answer，提取内容并渲染 Markdown
        const extractedFinalAnswer = this.extractFinalAnswer(content)
        if (extractedFinalAnswer) {
          // 包含 Final Answer，立即渲染 Markdown
          this.config.onFinalAnswerRender?.(extractedFinalAnswer)
        }

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

          // 使用栈来跟踪未闭合的结构
          const stack: string[] = []
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
              if (!inString && stack.length > 0 && stack[stack.length - 1] === '"') {
                stack.pop() // 闭合字符串
              } else if (inString) {
                stack.push('"') // 进入字符串
              }
              continue
            }

            if (!inString) {
              if (char === '{' || char === '[') {
                stack.push(char)
              } else if (char === '}') {
                if (stack.length > 0 && stack[stack.length - 1] === '{') {
                  stack.pop()
                }
              } else if (char === ']') {
                if (stack.length > 0 && stack[stack.length - 1] === '[') {
                  stack.pop()
                }
              }
            }
          }

          // 如果在字符串中，先闭合字符串
          if (inString) {
            jsonStr += '"'
          }

          // 反向闭合栈中的结构
          while (stack.length > 0) {
            const open = stack.pop()
            if (open === '"') {
              jsonStr += '"'
            } else if (open === '[') {
              jsonStr += ']'
            } else if (open === '{') {
              jsonStr += '}'
            }
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
      // 准备确认上下文信息（原始内容、修改后内容、文件路径）
      const confirmContext: {
        originalContent?: string
        modifiedContent?: string
        filePath?: string
      } = {}

      // 对于 modify_current_note 工具，获取原始内容和修改后的内容用于 diff 显示
      if (toolName === 'modify_current_note') {
        try {
          const { getFilePathOptions } = await import('@/lib/workspace')
          const { readTextFile } = await import('@tauri-apps/plugin-fs')
          const useArticleStore = (await import('@/stores/article')).default

          const articleStore = useArticleStore.getState()
          const currentFilePath = articleStore.activeFilePath

          if (currentFilePath) {
            confirmContext.filePath = currentFilePath

            // 读取原始内容
            const { path, baseDir } = await getFilePathOptions(currentFilePath)
            let originalContent = ''
            if (baseDir) {
              originalContent = await readTextFile(path, { baseDir })
            } else {
              originalContent = await readTextFile(path)
            }

            // 导入工具函数来计算修改后的内容
            const { searchReplaceContent, insertLinesAtPosition, deleteLinesInRange, replaceLinesInRange } = await import('./react-diff-helpers')

            // 计算修改后的内容（用于 diff 显示）
            let modifiedContent = originalContent

            if (params.searchReplace) {
              const sr = params.searchReplace
              modifiedContent = searchReplaceContent(
                modifiedContent,
                sr.searchPattern || '',
                sr.replacement || '',
                sr.useRegex || false,
                sr.caseSensitive || false,
                sr.replaceAll !== false
              )
            } else if (params.insertLines) {
              const il = params.insertLines
              const newLines = Array.isArray(il.newLines) ? il.newLines : [il.newLines]
              modifiedContent = insertLinesAtPosition(
                modifiedContent,
                il.afterLine || 0,
                newLines
              )
            } else if (params.deleteLines) {
              const dl = params.deleteLines
              modifiedContent = deleteLinesInRange(
                modifiedContent,
                dl.startLine,
                dl.endLine
              )
            } else if (params.lineEdits && Array.isArray(params.lineEdits)) {
              // 处理 lineEdits
              const sortedEdits = [...params.lineEdits].sort((a, b) => b.startLine - a.startLine)
              for (const edit of sortedEdits) {
                modifiedContent = replaceLinesInRange(
                  modifiedContent,
                  edit.startLine,
                  edit.endLine,
                  edit.newLines
                )
              }
            } else if (params.content) {
              modifiedContent = params.content
            }

            // 提取变化的区域（只显示有变化的行及其上下文）
            const extractChangedRegion = (original: string, modified: string, contextLines = 3) => {
              const originalLines = original.split('\n')
              const modifiedLines = modified.split('\n')

              // 找到第一个和最后一个不同的行
              let firstDiff = -1
              let lastDiff = -1

              const maxLines = Math.max(originalLines.length, modifiedLines.length)
              for (let i = 0; i < maxLines; i++) {
                if (originalLines[i] !== modifiedLines[i]) {
                  if (firstDiff === -1) firstDiff = i
                  lastDiff = i
                }
              }

              // 如果没有变化，返回前 50 行
              if (firstDiff === -1) {
                const previewLines = 50
                return {
                  original: originalLines.slice(0, previewLines).join('\n'),
                  modified: modifiedLines.slice(0, previewLines).join('\n')
                }
              }

              // 提取变化区域及其上下文
              const start = Math.max(0, firstDiff - contextLines)
              const end = Math.min(maxLines, lastDiff + contextLines + 1)

              return {
                original: originalLines.slice(start, end).join('\n'),
                modified: modifiedLines.slice(start, end).join('\n'),
                hasMore: end < maxLines
              }
            }

            const changedRegion = extractChangedRegion(originalContent, modifiedContent)
            confirmContext.originalContent = changedRegion.original
            confirmContext.modifiedContent = changedRegion.modified

          }
        } catch (error) {
          console.error('[Agent] Failed to prepare diff context:', error)
        }
      }

      const confirmed = await this.config.requestConfirmation(toolName, params, confirmContext)

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
        const errorMsg = result.error || '未知错误'
        return `工具 ${toolName} 执行失败：${errorMsg}`
      }
    } catch (error) {
      toolCall.status = 'error'
      const errorStr = error instanceof Error ? error.message : String(error)
      toolCall.result = {
        success: false,
        error: errorStr,
      }
      this.config.onToolCall?.(toolCall)
      return `工具 ${toolName} 执行出错：${errorStr}`
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

After selecting Skill, you will receive complete Skill instructions in next iteration. Then you can use actual tools (like create_file) to complete the task.

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

      // 添加可用脚本列表
      if (skill.scripts && skill.scripts.length > 0) {
        skillText += `**Available Scripts**:\n`
        for (const script of skill.scripts) {
          skillText += `  - \`${script.name}\` (${script.type})\n`
        }
        skillText += `\n`
      }

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
5. **Use actual tools to complete tasks** - Like create_file, modify_current_note, etc.

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
   * 从内容中提取 Final Answer（用于流式渲染 Markdown）
   */
  private extractFinalAnswer(content: string): string | null {
    // 检测是否包含 Final Answer
    const normalizedContent = content.replace(/\s+/g, ' ')
    const hasFinalAnswer = normalizedContent.includes('Final Answer:') ||
                           normalizedContent.includes('Final Answer：') ||
                           normalizedContent.includes('最终答案') ||
                           /Action:\s*Final\s*Answer/i.test(content)

    if (!hasFinalAnswer) {
      return null
    }

    // 提取 Final Answer 后面的内容
    let result: string | null = null
    if (content.includes('Final Answer:')) {
      result = content.split('Final Answer:')[1].trim()
    } else if (content.includes('Final Answer：')) {
      result = content.split('Final Answer：')[1].trim()
    } else if (content.includes('最终答案')) {
      result = content.split('最终答案')[1].trim()
    } else if (/Action:\s*Final\s*Answer:\s*([\s\S]*)/i.test(content)) {
      const match = content.match(/Action:\s*Final\s*Answer:\s*([\s\S]*)/i)
      if (match) {
        result = match[1].trim()
      }
    }

    return result
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
