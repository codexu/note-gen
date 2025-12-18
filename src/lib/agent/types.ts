export type ToolParameterType = 'string' | 'number' | 'boolean' | 'array' | 'object'

export interface ToolParameter {
  name: string
  type: ToolParameterType
  description: string
  required: boolean
  default?: any
}

export interface Tool {
  name: string
  description: string
  parameters: ToolParameter[]
  requiresConfirmation: boolean
  category: 'note' | 'chat' | 'tag' | 'mark' | 'search' | 'mcp'
  execute: (params: Record<string, any>) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
  message?: string
}

export interface ToolCall {
  id: string
  toolName: string
  params: Record<string, any>
  result?: ToolResult
  status: 'pending' | 'running' | 'success' | 'error'
  timestamp: number
}

export type ChatMode = 'chat' | 'agent'

export interface ConfirmationRecord {
  toolName: string
  params: Record<string, any>
  status: 'pending' | 'confirmed' | 'cancelled'
  timestamp: number
}

export interface AgentState {
  isRunning: boolean
  currentThought: string
  thoughtHistory: string[] // 累积的思考历史
  currentAction?: string
  currentObservation?: string
  toolCalls: ToolCall[]
  maxIterations: number
  currentIteration: number
  pendingConfirmation?: {
    toolName: string
    params: Record<string, any>
  }
  confirmationHistory: ConfirmationRecord[] // 确认操作的历史记录
}

export interface ReActStep {
  thought: string
  action?: {
    tool: string
    params: Record<string, any>
  }
  observation?: string
}
