import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 工具参数类型
export type ToolParamType = 'string' | 'number' | 'boolean' | 'array' | 'object'

// 工具参数定义
export interface ToolParameter {
  name: string
  type: ToolParamType
  description: string
  required: boolean
  defaultValue?: unknown
  enum?: string[]
}

// 工具定义
export interface Tool {
  id: string
  name: string
  displayName?: string
  description: string
  parameters: ToolParameter[]
  isBuiltin: boolean
  isEnabled: boolean
  category: ToolCategory
  // 自定义工具的执行模板
  template?: string
  // 隐形工具: 结果不显示在聊天中，不触发后续生成
  stealth?: boolean
  // 动态注册回调 (决定是否应该注册到 AI)
  shouldRegister?: () => Promise<boolean>
  // 格式化工具调用消息
  formatMessage?: (params: Record<string, unknown>) => Promise<string>
}

// 工具分类
export type ToolCategory = 
  | 'search'      // 搜索类
  | 'calculate'   // 计算类
  | 'datetime'    // 日期时间
  | 'random'      // 随机类
  | 'text'        // 文本处理
  | 'custom'      // 自定义

// 工具调用
export interface ToolCall {
  id: string
  toolName: string
  arguments: Record<string, unknown>
  timestamp: number
}

// 工具调用结果
export interface ToolCallResult {
  callId: string
  toolName: string
  success: boolean
  result?: string
  error?: string
  timestamp: number
}

// 工具调用配置
export interface ToolCallingConfig {
  enabled: boolean
  autoExecute: boolean        // 自动执行工具调用
  showToolCalls: boolean      // 显示工具调用过程
  maxCalls: number            // 单次最大调用次数
  timeout: number             // 超时时间 (ms)
  recurseLimit: number        // 递归调用最大次数
  hideStealthResults: boolean // 隐藏隐形工具结果
}

// 内置工具
export const BUILTIN_TOOLS: Omit<Tool, 'id'>[] = [
  // 搜索类
  {
    name: 'search_notes',
    description: '搜索用户笔记内容',
    parameters: [
      { name: 'query', type: 'string', description: '搜索关键词', required: true },
      { name: 'limit', type: 'number', description: '结果数量限制', required: false, defaultValue: 5 },
    ],
    isBuiltin: true,
    isEnabled: true,
    category: 'search',
  },
  {
    name: 'search_world_info',
    description: '搜索 World Info 条目',
    parameters: [
      { name: 'query', type: 'string', description: '搜索关键词', required: true },
    ],
    isBuiltin: true,
    isEnabled: true,
    category: 'search',
  },
  
  // 计算类
  {
    name: 'calculate',
    description: '执行数学计算',
    parameters: [
      { name: 'expression', type: 'string', description: '数学表达式', required: true },
    ],
    isBuiltin: true,
    isEnabled: true,
    category: 'calculate',
  },
  
  // 日期时间
  {
    name: 'get_current_time',
    description: '获取当前时间',
    parameters: [
      { name: 'format', type: 'string', description: '时间格式', required: false, defaultValue: 'full' },
    ],
    isBuiltin: true,
    isEnabled: true,
    category: 'datetime',
  },
  {
    name: 'get_date_diff',
    description: '计算日期差',
    parameters: [
      { name: 'date1', type: 'string', description: '日期1 (YYYY-MM-DD)', required: true },
      { name: 'date2', type: 'string', description: '日期2 (YYYY-MM-DD)', required: false },
    ],
    isBuiltin: true,
    isEnabled: true,
    category: 'datetime',
  },
  
  // 随机类
  {
    name: 'roll_dice',
    description: '掷骰子',
    parameters: [
      { name: 'sides', type: 'number', description: '骰子面数', required: false, defaultValue: 6 },
      { name: 'count', type: 'number', description: '骰子数量', required: false, defaultValue: 1 },
    ],
    isBuiltin: true,
    isEnabled: true,
    category: 'random',
  },
  {
    name: 'random_choice',
    description: '随机选择',
    parameters: [
      { name: 'options', type: 'array', description: '选项列表', required: true },
    ],
    isBuiltin: true,
    isEnabled: true,
    category: 'random',
  },
  
  // 文本处理
  {
    name: 'count_words',
    description: '统计文本字数',
    parameters: [
      { name: 'text', type: 'string', description: '文本内容', required: true },
    ],
    isBuiltin: true,
    isEnabled: true,
    category: 'text',
  },
  {
    name: 'summarize',
    description: '生成文本摘要',
    parameters: [
      { name: 'text', type: 'string', description: '文本内容', required: true },
      { name: 'maxLength', type: 'number', description: '最大长度', required: false, defaultValue: 100 },
    ],
    isBuiltin: true,
    isEnabled: true,
    category: 'text',
  },
]

interface TavernToolCallingState {
  // 配置
  config: ToolCallingConfig
  
  // 自定义工具
  customTools: Tool[]
  
  // 内置工具启用状态
  builtinEnabled: Record<string, boolean>
  
  // 调用历史
  callHistory: ToolCallResult[]
  
  // 待处理的调用
  pendingCalls: ToolCall[]
  
  // 配置管理
  updateConfig: (updates: Partial<ToolCallingConfig>) => void
  
  // 工具管理
  addCustomTool: (tool: Omit<Tool, 'id' | 'isBuiltin'>) => string
  updateCustomTool: (id: string, updates: Partial<Tool>) => void
  deleteCustomTool: (id: string) => void
  toggleBuiltinTool: (name: string, enabled: boolean) => void
  
  // 获取工具
  getAllTools: () => Tool[]
  getToolByName: (name: string) => Tool | null
  getToolsForAI: () => {
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
    stealth: boolean
  }[]
  getNonStealthToolsForAI: () => {
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }[]
  isStealthTool: (name: string) => boolean
  
  // 调用管理
  addPendingCall: (call: Omit<ToolCall, 'id' | 'timestamp'>) => string
  removePendingCall: (id: string) => void
  clearPendingCalls: () => void
  
  // 结果管理
  addCallResult: (result: Omit<ToolCallResult, 'timestamp'>) => void
  getCallHistory: (limit?: number) => ToolCallResult[]
  clearCallHistory: () => void
}

// 生成唯一 ID
function generateId(): string {
  return `tool-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// 默认配置
const DEFAULT_CONFIG: ToolCallingConfig = {
  enabled: false,
  autoExecute: true,
  showToolCalls: true,
  maxCalls: 5,
  timeout: 30000,
  recurseLimit: 5,
  hideStealthResults: true,
}

export const useTavernToolCallingStore = create<TavernToolCallingState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      customTools: [],
      builtinEnabled: {},
      callHistory: [],
      pendingCalls: [],
      
      updateConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
        }))
      },
      
      addCustomTool: (tool) => {
        const id = generateId()
        set((state) => ({
          customTools: [
            ...state.customTools,
            { ...tool, id, isBuiltin: false },
          ],
        }))
        return id
      },
      
      updateCustomTool: (id, updates) => {
        set((state) => ({
          customTools: state.customTools.map(t =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }))
      },
      
      deleteCustomTool: (id) => {
        set((state) => ({
          customTools: state.customTools.filter(t => t.id !== id),
        }))
      },
      
      toggleBuiltinTool: (name, enabled) => {
        set((state) => ({
          builtinEnabled: { ...state.builtinEnabled, [name]: enabled },
        }))
      },
      
      getAllTools: () => {
        const { customTools, builtinEnabled } = get()
        
        const builtins: Tool[] = BUILTIN_TOOLS.map((t, i) => ({
          ...t,
          id: `builtin-${i}`,
          isEnabled: builtinEnabled[t.name] !== false,
        }))
        
        return [...builtins, ...customTools]
      },
      
      getToolByName: (name) => {
        const allTools = get().getAllTools()
        return allTools.find(t => t.name === name && t.isEnabled) || null
      },
      
      getToolsForAI: () => {
        const { config } = get()
        if (!config.enabled) return []
        
        const tools = get().getAllTools().filter(t => t.isEnabled)
        
        return tools.map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: tool.parameters.reduce((acc, param) => {
                acc[param.name] = {
                  type: param.type,
                  description: param.description,
                  ...(param.enum ? { enum: param.enum } : {}),
                }
                return acc
              }, {} as Record<string, unknown>),
              required: tool.parameters.filter(p => p.required).map(p => p.name),
            },
          },
          stealth: tool.stealth || false,
        }))
      },

      // 获取非隐形工具 (OpenAI 格式)
      getNonStealthToolsForAI: () => {
        const { config } = get()
        if (!config.enabled) return []
        
        const tools = get().getAllTools().filter(t => t.isEnabled && !t.stealth)
        
        return tools.map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: tool.parameters.reduce((acc, param) => {
                acc[param.name] = {
                  type: param.type,
                  description: param.description,
                  ...(param.enum ? { enum: param.enum } : {}),
                }
                return acc
              }, {} as Record<string, unknown>),
              required: tool.parameters.filter(p => p.required).map(p => p.name),
            },
          },
        }))
      },

      // 检查工具是否为隐形工具
      isStealthTool: (name: string) => {
        const tool = get().getToolByName(name)
        return tool?.stealth || false
      },
      
      addPendingCall: (call) => {
        const id = generateId()
        set((state) => ({
          pendingCalls: [
            ...state.pendingCalls,
            { ...call, id, timestamp: Date.now() },
          ],
        }))
        return id
      },
      
      removePendingCall: (id) => {
        set((state) => ({
          pendingCalls: state.pendingCalls.filter(c => c.id !== id),
        }))
      },
      
      clearPendingCalls: () => {
        set({ pendingCalls: [] })
      },
      
      addCallResult: (result) => {
        set((state) => ({
          callHistory: [
            { ...result, timestamp: Date.now() },
            ...state.callHistory,
          ].slice(0, 100), // 保留最近 100 条
        }))
      },
      
      getCallHistory: (limit = 20) => {
        return get().callHistory.slice(0, limit)
      },
      
      clearCallHistory: () => {
        set({ callHistory: [] })
      },
    }),
    {
      name: 'tavern-tool-calling',
      partialize: (state) => ({
        config: state.config,
        customTools: state.customTools,
        builtinEnabled: state.builtinEnabled,
      }),
    }
  )
)
