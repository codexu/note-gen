import { ReActAgent, ReActConfig } from './react'
import { ToolCall } from './types'
import useChatStore from '@/stores/chat'

export interface AgentHandlerConfig {
  onThought?: (thought: string) => void
  onAction?: (action: string, params: Record<string, any>) => void
  onObservation?: (observation: string) => void
  onComplete?: (result: string) => void
  onError?: (error: string) => void
  requestConfirmation?: (toolName: string, params: Record<string, any>) => Promise<boolean>
}

export class AgentHandler {
  private agent: ReActAgent | null = null
  private config: AgentHandlerConfig

  constructor(config: AgentHandlerConfig) {
    this.config = config
  }

  async execute(userInput: string, context?: string): Promise<string> {
    const store = useChatStore.getState()
    
    store.resetAgentState()
    store.setAgentState({ isRunning: true })

    const reactConfig: ReActConfig = {
      maxIterations: 15,
      onIterationStart: () => {
        // 在新迭代开始时，将当前思考保存到历史
        const currentState = useChatStore.getState()
        if (currentState.agentState.currentThought) {
          const newHistory = [...currentState.agentState.thoughtHistory, currentState.agentState.currentThought]
          store.setAgentState({ 
            thoughtHistory: newHistory,
            currentThought: ''
          })
        }
      },
      onThought: (thought: string) => {
        // 流式输出时只更新当前思考，不保存到历史
        store.setAgentState({ currentThought: thought })
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
      const result = await this.agent.run(userInput, context)
      store.setAgentState({ isRunning: false })
      
      // 如果结果为空字符串，说明被用户终止
      if (result === '') {
        // 不调用 onComplete，让 handleStop 处理终止消息
        return ''
      }
      
      this.config.onComplete?.(result)
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
