import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 变量作用域
export type VariableScope = 'global' | 'chat' | 'message'

// 变量定义
export interface Variable {
  id: string
  name: string
  value: string
  scope: VariableScope
  scopeId?: number        // chat ID 或 message ID (仅 chat/message 作用域)
  description?: string
  createdAt: number
  updatedAt: number
}

// 变量配置
export interface VariablesConfig {
  enabled: boolean
  persistGlobal: boolean   // 是否持久化全局变量
  persistChat: boolean     // 是否持久化聊天变量
  maxVariables: number     // 最大变量数量
}

interface TavernVariablesState {
  // 配置
  config: VariablesConfig
  
  // 全局变量
  globalVariables: Variable[]
  
  // 聊天变量 (chatId -> variables)
  chatVariables: Record<number, Variable[]>
  
  // 临时消息变量 (不持久化)
  messageVariables: Variable[]
  
  // 配置管理
  updateConfig: (updates: Partial<VariablesConfig>) => void
  
  // 全局变量管理
  setGlobalVariable: (name: string, value: string, description?: string) => void
  getGlobalVariable: (name: string) => string | null
  deleteGlobalVariable: (name: string) => void
  listGlobalVariables: () => Variable[]
  
  // 聊天变量管理
  setChatVariable: (chatId: number, name: string, value: string, description?: string) => void
  getChatVariable: (chatId: number, name: string) => string | null
  deleteChatVariable: (chatId: number, name: string) => void
  listChatVariables: (chatId: number) => Variable[]
  clearChatVariables: (chatId: number) => void
  
  // 消息变量管理 (临时)
  setMessageVariable: (name: string, value: string) => void
  getMessageVariable: (name: string) => string | null
  clearMessageVariables: () => void
  
  // 统一获取变量 (按优先级: message > chat > global)
  getVariable: (name: string, chatId?: number) => string | null
  getAllVariables: (chatId?: number) => Record<string, string>
  
  // 变量表达式求值
  evaluateExpression: (expr: string, chatId?: number) => string
}

// 生成唯一 ID
function generateId(): string {
  return `var-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// 默认配置
const DEFAULT_CONFIG: VariablesConfig = {
  enabled: true,
  persistGlobal: true,
  persistChat: true,
  maxVariables: 100,
}

export const useTavernVariablesStore = create<TavernVariablesState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      globalVariables: [],
      chatVariables: {},
      messageVariables: [],
      
      updateConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
        }))
      },
      
      // 全局变量
      setGlobalVariable: (name, value, description) => {
        const now = Date.now()
        set((state) => {
          const existing = state.globalVariables.find(v => v.name === name)
          if (existing) {
            return {
              globalVariables: state.globalVariables.map(v =>
                v.name === name
                  ? { ...v, value, description: description ?? v.description, updatedAt: now }
                  : v
              ),
            }
          }
          return {
            globalVariables: [
              ...state.globalVariables,
              {
                id: generateId(),
                name,
                value,
                scope: 'global',
                description,
                createdAt: now,
                updatedAt: now,
              },
            ],
          }
        })
      },
      
      getGlobalVariable: (name) => {
        const variable = get().globalVariables.find(v => v.name === name)
        return variable?.value ?? null
      },
      
      deleteGlobalVariable: (name) => {
        set((state) => ({
          globalVariables: state.globalVariables.filter(v => v.name !== name),
        }))
      },
      
      listGlobalVariables: () => get().globalVariables,
      
      // 聊天变量
      setChatVariable: (chatId, name, value, description) => {
        const now = Date.now()
        set((state) => {
          const chatVars = state.chatVariables[chatId] || []
          const existing = chatVars.find(v => v.name === name)
          
          if (existing) {
            return {
              chatVariables: {
                ...state.chatVariables,
                [chatId]: chatVars.map(v =>
                  v.name === name
                    ? { ...v, value, description: description ?? v.description, updatedAt: now }
                    : v
                ),
              },
            }
          }
          
          return {
            chatVariables: {
              ...state.chatVariables,
              [chatId]: [
                ...chatVars,
                {
                  id: generateId(),
                  name,
                  value,
                  scope: 'chat',
                  scopeId: chatId,
                  description,
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            },
          }
        })
      },
      
      getChatVariable: (chatId, name) => {
        const chatVars = get().chatVariables[chatId] || []
        const variable = chatVars.find(v => v.name === name)
        return variable?.value ?? null
      },
      
      deleteChatVariable: (chatId, name) => {
        set((state) => ({
          chatVariables: {
            ...state.chatVariables,
            [chatId]: (state.chatVariables[chatId] || []).filter(v => v.name !== name),
          },
        }))
      },
      
      listChatVariables: (chatId) => get().chatVariables[chatId] || [],
      
      clearChatVariables: (chatId) => {
        set((state) => {
          const newVars = { ...state.chatVariables }
          delete newVars[chatId]
          return { chatVariables: newVars }
        })
      },
      
      // 消息变量 (临时)
      setMessageVariable: (name, value) => {
        const now = Date.now()
        set((state) => {
          const existing = state.messageVariables.find(v => v.name === name)
          if (existing) {
            return {
              messageVariables: state.messageVariables.map(v =>
                v.name === name ? { ...v, value, updatedAt: now } : v
              ),
            }
          }
          return {
            messageVariables: [
              ...state.messageVariables,
              {
                id: generateId(),
                name,
                value,
                scope: 'message',
                createdAt: now,
                updatedAt: now,
              },
            ],
          }
        })
      },
      
      getMessageVariable: (name) => {
        const variable = get().messageVariables.find(v => v.name === name)
        return variable?.value ?? null
      },
      
      clearMessageVariables: () => {
        set({ messageVariables: [] })
      },
      
      // 统一获取 (优先级: message > chat > global)
      getVariable: (name, chatId) => {
        const { messageVariables, chatVariables, globalVariables } = get()
        
        // 1. 消息变量
        const msgVar = messageVariables.find(v => v.name === name)
        if (msgVar) return msgVar.value
        
        // 2. 聊天变量
        if (chatId !== undefined) {
          const chatVar = (chatVariables[chatId] || []).find(v => v.name === name)
          if (chatVar) return chatVar.value
        }
        
        // 3. 全局变量
        const globalVar = globalVariables.find(v => v.name === name)
        if (globalVar) return globalVar.value
        
        return null
      },
      
      getAllVariables: (chatId) => {
        const { messageVariables, chatVariables, globalVariables } = get()
        const result: Record<string, string> = {}
        
        // 按优先级从低到高添加 (后面的会覆盖前面的)
        globalVariables.forEach(v => { result[v.name] = v.value })
        if (chatId !== undefined) {
          (chatVariables[chatId] || []).forEach(v => { result[v.name] = v.value })
        }
        messageVariables.forEach(v => { result[v.name] = v.value })
        
        return result
      },
      
      // 表达式求值
      evaluateExpression: (expr, chatId) => {
        const getVar = get().getVariable
        
        // 简单的数学表达式求值
        try {
          // 替换变量引用
          let evaluated = expr.replace(/\$(\w+)/g, (_, name) => {
            const value = getVar(name, chatId)
            return value ?? '0'
          })
          
          // 安全的数学运算 (只允许数字和基本运算符)
          if (/^[\d\s+\-*/().]+$/.test(evaluated)) {
            // eslint-disable-next-line no-eval
            const result = eval(evaluated)
            return String(result)
          }
          
          return evaluated
        } catch {
          return expr
        }
      },
    }),
    {
      name: 'tavern-variables',
      partialize: (state) => ({
        config: state.config,
        globalVariables: state.config.persistGlobal ? state.globalVariables : [],
        chatVariables: state.config.persistChat ? state.chatVariables : {},
      }),
    }
  )
)
