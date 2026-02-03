import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 宏定义
export interface MacroDefinition {
  id: string
  name: string           // 宏名称 (不含 {{}})
  description: string
  value: string          // 宏值 (可包含其他宏)
  isBuiltin: boolean     // 是否内置宏
  isEnabled: boolean
  category: MacroCategory
}

// 宏分类
export type MacroCategory = 
  | 'character'    // 角色相关
  | 'user'         // 用户相关
  | 'chat'         // 聊天相关
  | 'time'         // 时间相关
  | 'random'       // 随机相关
  | 'system'       // 系统相关
  | 'custom'       // 自定义

// 宏上下文 (用于解析宏时提供数据)
export interface MacroContext {
  characterName?: string
  characterDescription?: string
  characterPersonality?: string
  characterScenario?: string
  userName?: string
  userPersona?: string
  chatId?: number
  messageCount?: number
  lastMessage?: string
  // 自定义变量
  variables?: Record<string, string>
}

// 内置宏列表
export const BUILTIN_MACROS: Omit<MacroDefinition, 'id'>[] = [
  // 角色相关
  { name: 'char', description: '角色名称', value: '{{characterName}}', isBuiltin: true, isEnabled: true, category: 'character' },
  { name: 'charname', description: '角色名称 (别名)', value: '{{characterName}}', isBuiltin: true, isEnabled: true, category: 'character' },
  { name: 'description', description: '角色描述', value: '{{characterDescription}}', isBuiltin: true, isEnabled: true, category: 'character' },
  { name: 'personality', description: '角色性格', value: '{{characterPersonality}}', isBuiltin: true, isEnabled: true, category: 'character' },
  { name: 'scenario', description: '场景描述', value: '{{characterScenario}}', isBuiltin: true, isEnabled: true, category: 'character' },
  
  // 用户相关
  { name: 'user', description: '用户名称', value: '{{userName}}', isBuiltin: true, isEnabled: true, category: 'user' },
  { name: 'persona', description: '用户人设', value: '{{userPersona}}', isBuiltin: true, isEnabled: true, category: 'user' },
  
  // 时间相关
  { name: 'time', description: '当前时间 (HH:MM)', value: '{{currentTime}}', isBuiltin: true, isEnabled: true, category: 'time' },
  { name: 'date', description: '当前日期 (YYYY-MM-DD)', value: '{{currentDate}}', isBuiltin: true, isEnabled: true, category: 'time' },
  { name: 'weekday', description: '星期几', value: '{{currentWeekday}}', isBuiltin: true, isEnabled: true, category: 'time' },
  { name: 'isotime', description: 'ISO 时间戳', value: '{{isoTime}}', isBuiltin: true, isEnabled: true, category: 'time' },
  
  // 随机相关
  { name: 'roll', description: '掷骰子 (1-100)', value: '{{roll:1-100}}', isBuiltin: true, isEnabled: true, category: 'random' },
  { name: 'random', description: '随机选择', value: '{{random}}', isBuiltin: true, isEnabled: true, category: 'random' },
  
  // 聊天相关
  { name: 'lastMessage', description: '最后一条消息', value: '{{lastMessage}}', isBuiltin: true, isEnabled: true, category: 'chat' },
  { name: 'messageCount', description: '消息数量', value: '{{messageCount}}', isBuiltin: true, isEnabled: true, category: 'chat' },
  
  // 系统相关
  { name: 'newline', description: '换行符', value: '\n', isBuiltin: true, isEnabled: true, category: 'system' },
  { name: 'tab', description: '制表符', value: '\t', isBuiltin: true, isEnabled: true, category: 'system' },
]

interface TavernMacrosState {
  // 自定义宏
  customMacros: MacroDefinition[]
  
  // 内置宏启用状态
  builtinEnabled: Record<string, boolean>
  
  // 宏管理
  addCustomMacro: (macro: Omit<MacroDefinition, 'id' | 'isBuiltin'>) => string
  updateCustomMacro: (id: string, updates: Partial<MacroDefinition>) => void
  deleteCustomMacro: (id: string) => void
  
  // 内置宏管理
  toggleBuiltinMacro: (name: string, enabled: boolean) => void
  
  // 获取所有可用宏
  getAllMacros: () => MacroDefinition[]
  getMacroByName: (name: string) => MacroDefinition | null
  
  // 解析宏
  resolveMacros: (text: string, context: MacroContext) => string
}

// 生成唯一 ID
function generateId(): string {
  return `macro-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useTavernMacrosStore = create<TavernMacrosState>()(
  persist(
    (set, get) => ({
      customMacros: [],
      builtinEnabled: {},
      
      addCustomMacro: (macro) => {
        const id = generateId()
        set((state) => ({
          customMacros: [
            ...state.customMacros,
            { ...macro, id, isBuiltin: false },
          ],
        }))
        return id
      },
      
      updateCustomMacro: (id, updates) => {
        set((state) => ({
          customMacros: state.customMacros.map(m =>
            m.id === id ? { ...m, ...updates } : m
          ),
        }))
      },
      
      deleteCustomMacro: (id) => {
        set((state) => ({
          customMacros: state.customMacros.filter(m => m.id !== id),
        }))
      },
      
      toggleBuiltinMacro: (name, enabled) => {
        set((state) => ({
          builtinEnabled: { ...state.builtinEnabled, [name]: enabled },
        }))
      },
      
      getAllMacros: () => {
        const { customMacros, builtinEnabled } = get()
        
        // 内置宏
        const builtins: MacroDefinition[] = BUILTIN_MACROS.map((m, i) => ({
          ...m,
          id: `builtin-${i}`,
          isEnabled: builtinEnabled[m.name] !== false, // 默认启用
        }))
        
        return [...builtins, ...customMacros]
      },
      
      getMacroByName: (name) => {
        const allMacros = get().getAllMacros()
        return allMacros.find(m => m.name === name && m.isEnabled) || null
      },
      
      resolveMacros: (text, context) => {
        if (!text) return text
        
        let result = text
        const maxIterations = 10 // 防止无限递归
        let iteration = 0
        
        // 循环解析，直到没有更多宏或达到最大迭代次数
        while (iteration < maxIterations) {
          const previousResult = result
          result = resolveMacrosOnce(result, context, get().getAllMacros())
          
          // 如果没有变化，停止迭代
          if (result === previousResult) break
          iteration++
        }
        
        return result
      },
    }),
    {
      name: 'tavern-macros',
      partialize: (state) => ({
        customMacros: state.customMacros,
        builtinEnabled: state.builtinEnabled,
      }),
    }
  )
)

// 单次宏解析
function resolveMacrosOnce(
  text: string, 
  context: MacroContext,
  macros: MacroDefinition[]
): string {
  let result = text
  
  // 解析 {{macroName}} 格式
  result = result.replace(/\{\{(\w+)(?::([^}]+))?\}\}/g, (match, name, args) => {
    // 先检查是否是内置动态宏
    const dynamicValue = resolveDynamicMacro(name, args, context)
    if (dynamicValue !== null) return dynamicValue
    
    // 查找自定义宏
    const macro = macros.find(m => m.name === name && m.isEnabled)
    if (macro) {
      return macro.value
    }
    
    // 未找到宏，保持原样
    return match
  })
  
  return result
}

// 解析动态宏 (需要运行时计算的宏)
function resolveDynamicMacro(
  name: string, 
  args: string | undefined,
  context: MacroContext
): string | null {
  switch (name) {
    // 角色相关
    case 'characterName':
      return context.characterName || ''
    case 'characterDescription':
      return context.characterDescription || ''
    case 'characterPersonality':
      return context.characterPersonality || ''
    case 'characterScenario':
      return context.characterScenario || ''
    
    // 用户相关
    case 'userName':
      return context.userName || ''
    case 'userPersona':
      return context.userPersona || ''
    
    // 时间相关
    case 'currentTime':
      return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    case 'currentDate':
      return new Date().toISOString().split('T')[0]
    case 'currentWeekday':
      return ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()]
    case 'isoTime':
      return new Date().toISOString()
    
    // 随机相关
    case 'roll': {
      const [min, max] = (args || '1-100').split('-').map(Number)
      return String(Math.floor(Math.random() * (max - min + 1)) + min)
    }
    case 'random': {
      if (!args) return ''
      const options = args.split(',').map(s => s.trim())
      return options[Math.floor(Math.random() * options.length)]
    }
    
    // 聊天相关
    case 'lastMessage':
      return context.lastMessage || ''
    case 'messageCount':
      return String(context.messageCount || 0)
    
    // 变量
    case 'getvar': {
      if (!args || !context.variables) return ''
      return context.variables[args] || ''
    }
    
    default:
      return null
  }
}
