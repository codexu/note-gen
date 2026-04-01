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
  category: 'note' | 'chat' | 'tag' | 'mark' | 'search' | 'mcp' | 'system' | 'editor'
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

export interface ConfirmationRecord {
  toolName: string
  params: Record<string, any>
  status: 'pending' | 'confirmed' | 'cancelled'
  timestamp: number
  scope?: 'once' | 'conversation'
  sessionApprovalType?: 'write' | 'runtime-script-skill'
  sessionApprovalSkillId?: string
}

export interface AgentState {
  activeChatId?: number
  isRunning: boolean
  isThinking: boolean // 是否正在等待 AI 生成新的思考
  currentThought: string
  thoughtHistory: string[] // 累积的思考历史（已弃用，保留用于兼容）
  completedSteps: ReActStep[] // 已完成的完整步骤（包含 thought, action, observation）
  currentAction?: string
  currentObservation?: string
  toolCalls: ToolCall[]
  maxIterations: number
  currentIteration: number
  pendingConfirmation?: {
    toolName: string
    params: Record<string, any>
    previewParams?: Record<string, any>
    originalContent?: string  // 原始内容（用于显示 diff）
    modifiedContent?: string  // 修改后的内容（用于显示 diff）
    filePath?: string         // 文件路径（用于显示在确认对话框中）
    canApproveForSession?: boolean
    sessionApprovalType?: 'write' | 'runtime-script-skill'
    sessionApprovalSkillId?: string
  }
  confirmationHistory: ConfirmationRecord[] // 确认操作的历史记录
  loadedSkills?: Array<{
    id: string
    name: string
    description?: string
  }> // 当前对话加载的 Skills 列表
  selectedSkills?: string[] // AI 选择的 Skill ID 列表
  currentStepStartTime?: number // 当前步骤开始时间戳（用于实时计算耗时）
  // RAG 相关字段（实时执行时显示）
  ragSources?: string[] // RAG 检索到的来源文件列表
  ragSourceDetails?: Array<{
    filepath: string
    filename: string
    content: string
  }> // RAG 检索到的来源文件详情
  // Final Answer 模式（检测到 Final Answer 时切换到 Markdown 渲染）
  isFinalAnswerMode?: boolean
  finalAnswerContent?: string
}

export interface ReActStep {
  thought: string
  action?: {
    tool: string
    params: Record<string, any>
  }
  observation?: string
  duration?: number  // 耗时（毫秒）
}
