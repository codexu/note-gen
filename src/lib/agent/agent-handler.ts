import { ReActAgent, ReActConfig } from './react'
import { ToolCall, ReActStep } from './types'
import useChatStore from '@/stores/chat'
import { skillManager } from '@/lib/skills'
import { useSkillsStore } from '@/stores/skills'

export interface AgentHandlerConfig {
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onComplete?: (result: string, steps?: any[], stopped?: boolean) => void
  onError?: (error: string) => void
  requestConfirmation?: (toolName: string, params: Record<string, any>) => Promise<boolean>
}

export class AgentHandler {
  private agent: ReActAgent | null = null
  private config: AgentHandlerConfig

  constructor(config: AgentHandlerConfig) {
    this.config = config
  }

  async execute(userInput: string, context?: string, imageUrls?: string[]): Promise<string> {
    const store = useChatStore.getState()

    store.resetAgentState()
    store.setAgentState({ isRunning: true })

    // 获取所有可用的 Skills（让 AI 自己选择）
    const activeSkills = await this.getAvailableSkills()

    const reactConfig: ReActConfig = {
      maxIterations: 15,
      activeSkills,
      onIterationStart: () => {
        // 在新迭代开始时，将完整的 ReAct 循环保存到历史，然后清空当前状态
        const currentState = useChatStore.getState()
        if (currentState.agentState.currentThought ||
            currentState.agentState.currentAction ||
            currentState.agentState.currentObservation) {
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

          // 创建完整的步骤
          const completedStep: ReActStep = {
            thought: currentState.agentState.currentThought,
            action: action,
            observation: currentState.agentState.currentObservation
          }

          const newHistory = [...currentState.agentState.thoughtHistory, currentState.agentState.currentThought]
          const newCompletedSteps = [...currentState.agentState.completedSteps, completedStep]
          store.setAgentState({
            thoughtHistory: newHistory,
            completedSteps: newCompletedSteps,
            currentThought: '',
            currentAction: undefined,
            currentObservation: undefined,
            isThinking: true  // 标记正在等待 AI 生成新的思考
          })
        } else {
          // 第一次迭代
          store.setAgentState({ isThinking: true })
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
      requestConfirmation: this.config.requestConfirmation,
    }

    this.agent = new ReActAgent(reactConfig)

    try {
      const result = await this.agent.run(userInput, context, imageUrls)
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
   * 获取所有可用的 Skills（不进行匹配，让 AI 自己选择）
   */
  private async getAvailableSkills(): Promise<string[]> {
    const skillsStore = useSkillsStore.getState()

    console.log('[Skills Debug] Getting available skills...', {
      skillsEnabled: skillsStore.enabled,
      autoMatch: skillsStore.autoMatch
    })

    // 如果 Skills 功能未启用，返回空数组
    if (!skillsStore.enabled) {
      console.log('[Skills Debug] Skills feature is disabled')
      return []
    }

    // 如果未启用自动匹配，返回空数组
    if (!skillsStore.autoMatch) {
      console.log('[Skills Debug] Auto match is disabled')
      return []
    }

    try {
      // 确保 Skill 管理器已初始化
      await skillManager.initialize()
      console.log('[Skills Debug] Skill manager initialized')

      // 获取所有已启用的 Skills
      const enabledSkills = await skillManager.getEnabledSkills()

      console.log('[Skills Debug] Available skills:', {
        total: enabledSkills.length,
        skills: enabledSkills.map(s => ({
          id: s.metadata.id,
          name: s.metadata.name,
          description: s.metadata.description
        }))
      })

      // 返回所有已启用 Skill 的 ID 列表，让 AI 自己选择使用哪些
      const skillIds = enabledSkills.map(skill => skill.metadata.id)
      console.log('[Skills Debug] Returning skill IDs:', skillIds)
      return skillIds
    } catch (error) {
      console.error('[Skills Debug] Failed to get skills:', error)
      return []
    }
  }
}
