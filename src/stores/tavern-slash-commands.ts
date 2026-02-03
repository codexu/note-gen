import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 命令参数类型
export type CommandArgType = 'string' | 'number' | 'boolean' | 'enum' | 'variable'

// 命令参数定义
export interface CommandArg {
  name: string
  type: CommandArgType
  description: string
  required: boolean
  defaultValue?: string
  enumValues?: string[]   // 仅 enum 类型
}

// 命令执行结果
export interface CommandResult {
  success: boolean
  output?: string         // 输出文本 (可选)
  error?: string          // 错误信息
  shouldSend?: boolean    // 是否发送消息
  modifiedInput?: string  // 修改后的输入
}

// 命令来源类型
export type CommandSource = 'builtin' | 'custom' | 'extension'

// 命令定义
export interface SlashCommand {
  id: string
  name: string            // 命令名 (不含 /)
  aliases: string[]       // 别名
  description: string
  args: CommandArg[]
  category: CommandCategory
  isBuiltin: boolean
  isEnabled: boolean
  // 自定义命令的执行脚本 (简单的模板替换)
  script?: string
  // 命令来源
  source?: CommandSource
  // 扩展 ID (仅当 source='extension' 时)
  extensionId?: string
  // 命令处理器 (可选，用于扩展注册的命令)
  handler?: CommandHandler
}

// 命令分类
export type CommandCategory = 
  | 'chat'        // 聊天相关
  | 'character'   // 角色相关
  | 'variable'    // 变量相关
  | 'system'      // 系统相关
  | 'utility'     // 工具类
  | 'custom'      // 自定义

// 命令执行上下文
export interface CommandContext {
  chatId?: number
  cardId?: number
  characterName?: string
  userName?: string
  input: string
  args: Record<string, string>
}

// 命令处理器类型
export type CommandHandler = (context: CommandContext) => Promise<CommandResult> | CommandResult

// 内置命令列表
export const BUILTIN_COMMANDS: Omit<SlashCommand, 'id'>[] = [
  // 聊天相关
  {
    name: 'send',
    aliases: ['s'],
    description: '发送消息',
    args: [{ name: 'message', type: 'string', description: '消息内容', required: true }],
    category: 'chat',
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: 'continue',
    aliases: ['cont', 'c'],
    description: '继续生成',
    args: [],
    category: 'chat',
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: 'regenerate',
    aliases: ['regen', 'r'],
    description: '重新生成最后一条回复',
    args: [],
    category: 'chat',
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: 'swipe',
    aliases: ['sw'],
    description: '切换回复',
    args: [{ name: 'direction', type: 'enum', description: '方向', required: false, enumValues: ['left', 'right'], defaultValue: 'right' }],
    category: 'chat',
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: 'impersonate',
    aliases: ['imp', 'i'],
    description: '以用户身份生成回复',
    args: [],
    category: 'chat',
    isBuiltin: true,
    isEnabled: true,
  },
  
  // 变量相关
  {
    name: 'setvar',
    aliases: ['set'],
    description: '设置变量',
    args: [
      { name: 'name', type: 'string', description: '变量名', required: true },
      { name: 'value', type: 'string', description: '变量值', required: true },
    ],
    category: 'variable',
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: 'getvar',
    aliases: ['get'],
    description: '获取变量值',
    args: [{ name: 'name', type: 'string', description: '变量名', required: true }],
    category: 'variable',
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: 'addvar',
    aliases: ['add'],
    description: '变量加法',
    args: [
      { name: 'name', type: 'string', description: '变量名', required: true },
      { name: 'value', type: 'number', description: '增加值', required: true },
    ],
    category: 'variable',
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: 'listvar',
    aliases: ['vars'],
    description: '列出所有变量',
    args: [],
    category: 'variable',
    isBuiltin: true,
    isEnabled: true,
  },
  
  // 系统相关
  {
    name: 'help',
    aliases: ['h', '?'],
    description: '显示帮助信息',
    args: [{ name: 'command', type: 'string', description: '命令名', required: false }],
    category: 'system',
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: 'clear',
    aliases: ['cls'],
    description: '清空输入框',
    args: [],
    category: 'system',
    isBuiltin: true,
    isEnabled: true,
  },
  
  // 工具类
  {
    name: 'roll',
    aliases: ['dice', 'd'],
    description: '掷骰子',
    args: [{ name: 'range', type: 'string', description: '范围 (如 1-100 或 d20)', required: false, defaultValue: '1-100' }],
    category: 'utility',
    isBuiltin: true,
    isEnabled: true,
  },
  {
    name: 'echo',
    aliases: ['print'],
    description: '输出文本',
    args: [{ name: 'text', type: 'string', description: '文本内容', required: true }],
    category: 'utility',
    isBuiltin: true,
    isEnabled: true,
  },
]

interface TavernSlashCommandsState {
  // 自定义命令
  customCommands: SlashCommand[]
  
  // 内置命令启用状态
  builtinEnabled: Record<string, boolean>
  
  // 命令历史
  commandHistory: string[]
  historyIndex: number
  
  // 命令管理
  addCustomCommand: (command: Omit<SlashCommand, 'id' | 'isBuiltin'>) => string
  updateCustomCommand: (id: string, updates: Partial<SlashCommand>) => void
  deleteCustomCommand: (id: string) => void
  /** 批量删除指定扩展的所有命令 */
  deleteCommandsByExtension: (extensionId: string) => void
  
  // 内置命令管理
  toggleBuiltinCommand: (name: string, enabled: boolean) => void
  
  // 获取命令
  getAllCommands: () => SlashCommand[]
  getCommandByName: (name: string) => SlashCommand | null
  /** 获取指定扩展的所有命令 */
  getCommandsByExtension: (extensionId: string) => SlashCommand[]
  
  // 解析命令
  parseCommand: (input: string) => { command: SlashCommand; args: Record<string, string>; rest: string } | null
  
  // 命令历史
  addToHistory: (command: string) => void
  getPreviousCommand: () => string | null
  getNextCommand: () => string | null
  resetHistoryIndex: () => void
  
  // 自动补全
  getCompletions: (partial: string) => SlashCommand[]
}

// 生成唯一 ID
function generateId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useTavernSlashCommandsStore = create<TavernSlashCommandsState>()(
  persist(
    (set, get) => ({
      customCommands: [],
      builtinEnabled: {},
      commandHistory: [],
      historyIndex: -1,
      
      addCustomCommand: (command) => {
        const id = generateId()
        set((state) => ({
          customCommands: [
            ...state.customCommands,
            { ...command, id, isBuiltin: false },
          ],
        }))
        return id
      },
      
      updateCustomCommand: (id, updates) => {
        set((state) => ({
          customCommands: state.customCommands.map(c =>
            c.id === id ? { ...c, ...updates } : c
          ),
        }))
      },
      
      deleteCustomCommand: (id) => {
        set((state) => ({
          customCommands: state.customCommands.filter(c => c.id !== id),
        }))
      },
      
      deleteCommandsByExtension: (extensionId) => {
        set((state) => ({
          customCommands: state.customCommands.filter(c => c.extensionId !== extensionId),
        }))
      },
      
      toggleBuiltinCommand: (name, enabled) => {
        set((state) => ({
          builtinEnabled: { ...state.builtinEnabled, [name]: enabled },
        }))
      },
      
      getAllCommands: () => {
        const { customCommands, builtinEnabled } = get()
        
        const builtins: SlashCommand[] = BUILTIN_COMMANDS.map((c, i) => ({
          ...c,
          id: `builtin-${i}`,
          isEnabled: builtinEnabled[c.name] !== false,
        }))
        
        return [...builtins, ...customCommands]
      },
      
      getCommandByName: (name) => {
        const allCommands = get().getAllCommands()
        const lowerName = name.toLowerCase()
        
        return allCommands.find(c => 
          c.isEnabled && (
            c.name.toLowerCase() === lowerName ||
            c.aliases.some(a => a.toLowerCase() === lowerName)
          )
        ) || null
      },
      
      getCommandsByExtension: (extensionId) => {
        const { customCommands } = get()
        return customCommands.filter(c => c.extensionId === extensionId)
      },
      
      parseCommand: (input) => {
        if (!input.startsWith('/')) return null
        
        // 解析命令名和参数
        const match = input.match(/^\/(\w+)(?:\s+(.*))?$/)
        if (!match) return null
        
        const [, cmdName, argsStr] = match
        const command = get().getCommandByName(cmdName)
        if (!command) return null
        
        // 解析参数
        const args: Record<string, string> = {}
        let rest = argsStr || ''
        
        if (argsStr) {
          // 简单的参数解析: 支持 key=value 和位置参数
          const parts = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g) || []
          let positionalIndex = 0
          
          for (const part of parts) {
            const kvMatch = part.match(/^(\w+)=(.*)$/)
            if (kvMatch) {
              // key=value 格式
              args[kvMatch[1]] = kvMatch[2].replace(/^"|"$/g, '')
            } else if (positionalIndex < command.args.length) {
              // 位置参数
              args[command.args[positionalIndex].name] = part.replace(/^"|"$/g, '')
              positionalIndex++
            }
          }
          
          // 剩余文本
          rest = parts.slice(positionalIndex).join(' ')
        }
        
        // 填充默认值
        for (const arg of command.args) {
          if (args[arg.name] === undefined && arg.defaultValue !== undefined) {
            args[arg.name] = arg.defaultValue
          }
        }
        
        return { command, args, rest }
      },
      
      addToHistory: (command) => {
        set((state) => {
          const newHistory = [command, ...state.commandHistory.filter(c => c !== command)].slice(0, 50)
          return { commandHistory: newHistory, historyIndex: -1 }
        })
      },
      
      getPreviousCommand: () => {
        const { commandHistory, historyIndex } = get()
        if (historyIndex < commandHistory.length - 1) {
          const newIndex = historyIndex + 1
          set({ historyIndex: newIndex })
          return commandHistory[newIndex]
        }
        return null
      },
      
      getNextCommand: () => {
        const { commandHistory, historyIndex } = get()
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1
          set({ historyIndex: newIndex })
          return commandHistory[newIndex]
        } else if (historyIndex === 0) {
          set({ historyIndex: -1 })
          return ''
        }
        return null
      },
      
      resetHistoryIndex: () => {
        set({ historyIndex: -1 })
      },
      
      getCompletions: (partial) => {
        if (!partial.startsWith('/')) return []
        
        const search = partial.slice(1).toLowerCase()
        const allCommands = get().getAllCommands()
        
        return allCommands.filter(c =>
          c.isEnabled && (
            c.name.toLowerCase().startsWith(search) ||
            c.aliases.some(a => a.toLowerCase().startsWith(search))
          )
        )
      },
    }),
    {
      name: 'tavern-slash-commands',
      partialize: (state) => ({
        customCommands: state.customCommands,
        builtinEnabled: state.builtinEnabled,
        commandHistory: state.commandHistory,
      }),
    }
  )
)
