import { ReActAgent, ReActConfig } from './react'
import { ToolCall } from './types'
import useChatStore from '@/stores/chat'

export interface AgentHandlerConfig {
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onComplete?: (result: string, steps?: any[]) => void
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

    const reactConfig: ReActConfig = {
      maxIterations: 15,
      onIterationStart: () => {
        // 在新迭代开始时，将完整的 ReAct 循环保存到历史，然后清空当前状态
        const currentState = useChatStore.getState()
        if (currentState.agentState.currentThought || 
            currentState.agentState.currentAction || 
            currentState.agentState.currentObservation) {
          const newHistory = [...currentState.agentState.thoughtHistory, currentState.agentState.currentThought]
          store.setAgentState({ 
            thoughtHistory: newHistory,
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
      
      // 如果结果为空字符串，说明被用户终止
      if (result === '') {
        // 不调用 onComplete，让 handleStop 处理终止消息
        return ''
      }
      
      // 获取完整的 ReAct 步骤
      const steps = this.agent.getSteps()
      this.config.onComplete?.(result, steps)
      return result
    } catch (error) {
      store.setAgentState({ isRunning: false })
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.config.onError?.(errorMessage)
      throw error
    }
  }

  stop() {
    if (this.agent) {
      this.agent.stop()
      this.agent = null
    }
    const store = useChatStore.getState()
    store.resetAgentState()
  }
}
