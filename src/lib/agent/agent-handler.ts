import { ReActAgent, ReActConfig } from './react'
import { ToolCall, ReActStep } from './types'
import useChatStore from '@/stores/chat'
import { skillManager } from '@/lib/skills'
import { useSkillsStore } from '@/stores/skills'
import { reloadMcpTools } from './tools'
import OpenAI from 'openai'

export interface AgentHandlerConfig {
  activeChatId?: number
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onComplete?: (result: string, steps?: any[], stopped?: boolean) => void
  onError?: (error: string) => void
  onFinalAnswerRender?: (markdownContent: string) => void  // 当检测到 Final Answer 时立即渲染 Markdown
  formatAutoFinalAnswer?: (key: string, values?: Record<string, string>) => string
  requestConfirmation?: (toolName: string, params: Record<string, any>) => Promise<boolean>
  currentQuote?: {
    fileName: string
    startLine: number
    endLine: number
    from: number
    to: number
    fullContent?: string
  }
}

export class AgentHandler {
  private agent: ReActAgent | null = null
  private config: AgentHandlerConfig

  constructor(config: AgentHandlerConfig) {
    this.config = config
  }

  async execute(
    userInput: string,
    contextOrMessages?: string | OpenAI.Chat.ChatCompletionMessageParam[],
    imageUrls?: string[]
  ): Promise<string> {
    const store = useChatStore.getState()

    store.resetAgentState()
    store.setAgentState({
      activeChatId: this.config.activeChatId,
      isRunning: true,
    })

    // 确保 MCP Store 已初始化
    try {
      const { useMcpStore } = await import('@/stores/mcp')
      const mcpStore = useMcpStore.getState()
      if (!mcpStore.initialized) {
        await mcpStore.initMcpData()
      }
    } catch (error) {
      console.error('[Agent Handler] Failed to initialize MCP Store:', error)
    }

    // 预加载 MCP 工具
    try {
      await reloadMcpTools()
    } catch (error) {
      console.error('[Agent Handler] Failed to reload MCP tools:', error)
    }

    // 获取所有可用的 Skills（让 AI 自己选择）
    const activeSkills = await this.getAvailableSkills()
    // 获取 Skills 的详细信息用于 UI 显示
    const skillsInfo = await this.getSkillsInfo()
    // 将加载的 Skills 信息存储到状态中，用于 UI 显示
    store.setAgentState({ loadedSkills: skillsInfo })

    const reactConfig: ReActConfig = {
      maxIterations: 15,
      activeSkills,
      onIterationStart: () => {
        // 在新迭代开始时，将完整的 ReAct 循环保存到历史，然后清空当前状态
        const currentState = useChatStore.getState()
        if (currentState.agentState.currentThought ||
            currentState.agentState.currentAction ||
            currentState.agentState.currentObservation) {
          // 检查是否是 Final Answer - 如果是，不添加到 completedSteps，直接清空
          const isFinalAnswer = currentState.agentState.currentThought.includes('Final Answer:') ||
                               currentState.agentState.currentThought.includes('Final Answer：') ||
                               currentState.agentState.currentThought.includes('最终答案')

          if (isFinalAnswer) {
            // Final Answer 不添加到步骤历史，直接清空状态（它会作为 result 在正文中显示）
            store.setAgentState({
              currentThought: '',
              currentAction: undefined,
              currentObservation: undefined,
              currentStepStartTime: undefined,
            })
            return
          }

          // 解析当前动作
          let action = undefined
          if (currentState.agentState.currentAction) {
            const match = currentState.agentState.currentAction.match(/^(\w+)\((.*)\)$/)
            if (match) {
              try {
                action = {
                  tool: match[1],
                  params: match[2] ? JSON.parse(match[2]) : {}
                }
              } catch {
                // 解析失败，忽略
              }
            }
          }

          // 计算步骤耗时
          const duration = currentState.agentState.currentStepStartTime
            ? Date.now() - currentState.agentState.currentStepStartTime
            : undefined

          // 创建完整的步骤
          const completedStep: ReActStep = {
            thought: currentState.agentState.currentThought,
            action: action,
            observation: currentState.agentState.currentObservation,
            duration
          }

          const newHistory = [...currentState.agentState.thoughtHistory, currentState.agentState.currentThought]
          const newCompletedSteps = [...currentState.agentState.completedSteps, completedStep]
          store.setAgentState({
            thoughtHistory: newHistory,
            completedSteps: newCompletedSteps,
            currentThought: '',
            currentAction: undefined,
            currentObservation: undefined,
            currentStepStartTime: Date.now(),  // 记录新步骤的开始时间
            isThinking: true  // 标记正在等待 AI 生成新的思考
          })
        }
      },
      onThought: (thought: string) => {
        // 流式输出时只更新当前思考，不保存到历史
        store.setAgentState({
          currentThought: thought,
          isThinking: false  // 开始输出内容，取消思考状态
        })
        this.config.onThought?.(thought)
      },
      onAction: (action, params) => {
        store.setAgentState({ currentAction: `${action}(${JSON.stringify(params)})` })
        this.config.onAction?.(action, params)
      },
      onObservation: (observation) => {
        store.setAgentState({ currentObservation: observation })
        this.config.onObservation?.(observation)
      },
      onToolCall: (toolCall: ToolCall) => {
        // 获取最新的 store 状态
        const currentState = useChatStore.getState()
        const existingCall = currentState.agentState.toolCalls.find(c => c.id === toolCall.id)
        if (existingCall) {
          currentState.updateAgentToolCall(toolCall.id, toolCall)
        } else {
          currentState.addAgentToolCall(toolCall)
        }
      },
      onSkillsSelected: (skillIds: string[]) => {
        // 当 AI 选择 Skills 后，更新状态
        store.setAgentState({ selectedSkills: skillIds })
      },
      onFinalAnswerRender: (markdownContent: string) => {
        // 检测到 Final Answer 时，触发外部渲染
        this.config.onFinalAnswerRender?.(markdownContent)
      },
      formatAutoFinalAnswer: this.config.formatAutoFinalAnswer,
      requestConfirmation: this.config.requestConfirmation,
      currentQuote: this.config.currentQuote,
    }

    // 在开始执行前设置当前步骤的开始时间（确保第一次思考也有耗时）
    store.setAgentState({
      isThinking: true,
      currentStepStartTime: Date.now()
    })

    this.agent = new ReActAgent(reactConfig)

    try {
      const result = await this.agent.run(userInput, contextOrMessages, imageUrls)
      store.setAgentState({ isRunning: false })

      // 获取完整的 ReAct 步骤
      const steps = this.agent.getSteps()
      this.config.onComplete?.(result, steps, false)
      return result
    } catch (error) {
      store.setAgentState({ isRunning: false })

      // 检查是否是用户终止
      if (error instanceof Error && error.message === 'USER_STOPPED') {
        // 获取已产生的步骤
        const steps = this.agent.getSteps()
        // 调用 onComplete，传入空结果和已产生的步骤，标记为已停止
        this.config.onComplete?.('', steps, true)
        return ''
      }

      const errorMessage = error instanceof Error ? error.message : String(error)
      this.config.onError?.(errorMessage)
      throw error
    }
  }

  stop() {
    if (this.agent) {
      this.agent.stop()
      // 不立即清空 agent，等待 run 方法中的错误处理完成
      // 不调用 resetAgentState，让 onComplete 回调保存已产生的内容
    }
  }

  /**
   * 获取所有可用的 Skills（只返回元数据，让 AI 先选择）
   */
  private async getAvailableSkills(): Promise<string[]> {
    const skillsStore = useSkillsStore.getState()

    // 如果 Skills 功能未启用，返回空数组
    if (!skillsStore.enabled) {
      return []
    }

    // 如果未启用自动匹配，返回空数组
    if (!skillsStore.autoMatch) {
      return []
    }

    try {
      // 确保 Skill 管理器已初始化（initSkills 会处理重复初始化）
      await skillsStore.initSkills()

      // 获取所有已启用的 Skills
      const enabledSkills = await skillManager.getEnabledSkills()

      // 返回所有已启用 Skill 的 ID 列表
      // 注意：这里只传递 ID，具体内容在 formatSkillsInstructions 中按需加载
      const skillIds = enabledSkills.map(skill => skill.metadata.id)
      return skillIds
    } catch (error) {
      console.error('[Skills Debug] Failed to get skills:', error)
      return []
    }
  }

  /**
   * 获取 Skills 的详细信息用于 UI 显示
   */
  private async getSkillsInfo(): Promise<Array<{ id: string; name: string; description?: string }>> {
    const skillsStore = useSkillsStore.getState()

    // 如果 Skills 功能未启用，返回空数组
    if (!skillsStore.enabled || !skillsStore.autoMatch) {
      return []
    }

    try {
      // 确保 Skill 管理器已初始化
      await skillsStore.initSkills()
      const enabledSkills = await skillManager.getEnabledSkills()

      return enabledSkills.map(skill => ({
        id: skill.metadata.id,
        name: skill.metadata.name,
        description: skill.metadata.description
      }))
    } catch (error) {
      console.error('[Skills Debug] Failed to get skills info:', error)
      return []
    }
  }
}
