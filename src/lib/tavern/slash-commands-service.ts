/**
 * Tavern Slash Commands 服务
 * 处理斜杠命令的执行
 */

import { 
  useTavernSlashCommandsStore, 
  CommandContext, 
  CommandResult,
  SlashCommand,
} from '@/stores/tavern-slash-commands'
import { useTavernVariablesStore } from '@/stores/tavern-variables'
import { useTavernMacrosStore } from '@/stores/tavern-macros'
import { executeScript, parseScript } from './stscript'

// 命令执行回调
export interface CommandCallbacks {
  onSend?: (message: string) => Promise<void>
  onContinue?: () => Promise<void>
  onRegenerate?: () => Promise<void>
  onSwipe?: (direction: 'left' | 'right') => Promise<void>
  onImpersonate?: () => Promise<void>
  onClear?: () => void
  onOutput?: (text: string) => void
}

/**
 * 执行斜杠命令
 */
export async function executeCommand(
  input: string,
  context: Partial<CommandContext>,
  callbacks: CommandCallbacks
): Promise<CommandResult> {
  const store = useTavernSlashCommandsStore.getState()
  const parsed = store.parseCommand(input)
  
  if (!parsed) {
    return { success: false, error: '无效的命令格式' }
  }
  
  const { command, args, rest } = parsed
  const fullContext: CommandContext = {
    ...context,
    input,
    args,
  }
  
  // 添加到历史
  store.addToHistory(input)
  
  // 执行命令
  try {
    const result = await executeBuiltinCommand(command, fullContext, callbacks, rest)
    return result
  } catch (error) {
    return { 
      success: false, 
      error: `命令执行失败: ${error instanceof Error ? error.message : String(error)}` 
    }
  }
}

/**
 * 执行内置命令
 */
async function executeBuiltinCommand(
  command: SlashCommand,
  context: CommandContext,
  callbacks: CommandCallbacks,
  rest: string
): Promise<CommandResult> {
  const variablesStore = useTavernVariablesStore.getState()
  const macrosStore = useTavernMacrosStore.getState()
  
  switch (command.name) {
    // 聊天相关
    case 'send': {
      const message = context.args.message || rest
      if (!message) {
        return { success: false, error: '请提供消息内容' }
      }
      // 解析宏
      const resolved = macrosStore.resolveMacros(message, {
        characterName: context.characterName,
        userName: context.userName,
        variables: variablesStore.getAllVariables(context.chatId),
      })
      if (callbacks.onSend) {
        await callbacks.onSend(resolved)
      }
      return { success: true, shouldSend: true, modifiedInput: resolved }
    }
    
    case 'continue': {
      if (callbacks.onContinue) {
        await callbacks.onContinue()
      }
      return { success: true, output: '继续生成...' }
    }
    
    case 'regenerate': {
      if (callbacks.onRegenerate) {
        await callbacks.onRegenerate()
      }
      return { success: true, output: '重新生成...' }
    }
    
    case 'swipe': {
      const direction = (context.args.direction || 'right') as 'left' | 'right'
      if (callbacks.onSwipe) {
        await callbacks.onSwipe(direction)
      }
      return { success: true, output: `切换到${direction === 'left' ? '上' : '下'}一个回复` }
    }
    
    case 'impersonate': {
      if (callbacks.onImpersonate) {
        await callbacks.onImpersonate()
      }
      return { success: true, output: '以用户身份生成...' }
    }
    
    // 变量相关
    case 'setvar': {
      const { name, value } = context.args
      if (!name) {
        return { success: false, error: '请提供变量名' }
      }
      const resolvedValue = macrosStore.resolveMacros(value || '', {
        characterName: context.characterName,
        userName: context.userName,
        variables: variablesStore.getAllVariables(context.chatId),
      })
      
      // 根据变量名前缀决定作用域
      if (name.startsWith('global.')) {
        variablesStore.setGlobalVariable(name.slice(7), resolvedValue)
      } else if (context.chatId !== undefined) {
        variablesStore.setChatVariable(context.chatId, name, resolvedValue)
      } else {
        variablesStore.setGlobalVariable(name, resolvedValue)
      }
      
      return { success: true, output: `变量 ${name} = ${resolvedValue}` }
    }
    
    case 'getvar': {
      const { name } = context.args
      if (!name) {
        return { success: false, error: '请提供变量名' }
      }
      const value = variablesStore.getVariable(name, context.chatId)
      if (value === null) {
        return { success: true, output: `变量 ${name} 未定义` }
      }
      return { success: true, output: `${name} = ${value}` }
    }
    
    case 'addvar': {
      const { name, value } = context.args
      if (!name) {
        return { success: false, error: '请提供变量名' }
      }
      const currentValue = variablesStore.getVariable(name, context.chatId)
      const current = parseFloat(currentValue || '0')
      const add = parseFloat(value || '1')
      const newValue = String(current + add)
      
      if (context.chatId !== undefined) {
        variablesStore.setChatVariable(context.chatId, name, newValue)
      } else {
        variablesStore.setGlobalVariable(name, newValue)
      }
      
      return { success: true, output: `${name} = ${newValue}` }
    }
    
    case 'listvar': {
      const globalVars = variablesStore.listGlobalVariables()
      const chatVars = context.chatId !== undefined 
        ? variablesStore.listChatVariables(context.chatId) 
        : []
      
      let output = '=== 变量列表 ===\n'
      
      if (globalVars.length > 0) {
        output += '\n[全局变量]\n'
        globalVars.forEach(v => {
          output += `  ${v.name} = ${v.value}\n`
        })
      }
      
      if (chatVars.length > 0) {
        output += '\n[聊天变量]\n'
        chatVars.forEach(v => {
          output += `  ${v.name} = ${v.value}\n`
        })
      }
      
      if (globalVars.length === 0 && chatVars.length === 0) {
        output += '\n(无变量)'
      }
      
      return { success: true, output }
    }
    
    // 系统相关
    case 'help': {
      const cmdName = context.args.command
      const allCommands = useTavernSlashCommandsStore.getState().getAllCommands()
      
      if (cmdName) {
        const cmd = allCommands.find(c => 
          c.name === cmdName || c.aliases.includes(cmdName)
        )
        if (!cmd) {
          return { success: false, error: `未找到命令: ${cmdName}` }
        }
        
        let output = `/${cmd.name}`
        if (cmd.aliases.length > 0) {
          output += ` (别名: ${cmd.aliases.map(a => '/' + a).join(', ')})`
        }
        output += `\n${cmd.description}\n`
        
        if (cmd.args.length > 0) {
          output += '\n参数:\n'
          cmd.args.forEach(arg => {
            const required = arg.required ? '(必需)' : '(可选)'
            output += `  ${arg.name} ${required}: ${arg.description}`
            if (arg.defaultValue) {
              output += ` [默认: ${arg.defaultValue}]`
            }
            output += '\n'
          })
        }
        
        return { success: true, output }
      }
      
      // 列出所有命令
      let output = '=== 可用命令 ===\n'
      const categories = new Map<string, SlashCommand[]>()
      
      allCommands.filter(c => c.isEnabled).forEach(cmd => {
        const list = categories.get(cmd.category) || []
        list.push(cmd)
        categories.set(cmd.category, list)
      })
      
      const categoryNames: Record<string, string> = {
        chat: '聊天',
        character: '角色',
        variable: '变量',
        system: '系统',
        utility: '工具',
        custom: '自定义',
      }
      
      categories.forEach((cmds, category) => {
        output += `\n[${categoryNames[category] || category}]\n`
        cmds.forEach(cmd => {
          output += `  /${cmd.name} - ${cmd.description}\n`
        })
      })
      
      output += '\n使用 /help <命令名> 查看详细帮助'
      
      return { success: true, output }
    }
    
    case 'clear': {
      if (callbacks.onClear) {
        callbacks.onClear()
      }
      return { success: true }
    }
    
    // 工具类
    case 'roll': {
      const range = context.args.range || '1-100'
      let min = 1, max = 100
      
      // 解析 d20 格式
      const diceMatch = range.match(/^d(\d+)$/i)
      if (diceMatch) {
        max = parseInt(diceMatch[1])
      } else {
        // 解析 min-max 格式
        const rangeMatch = range.match(/^(\d+)-(\d+)$/)
        if (rangeMatch) {
          min = parseInt(rangeMatch[1])
          max = parseInt(rangeMatch[2])
        }
      }
      
      const result = Math.floor(Math.random() * (max - min + 1)) + min
      return { success: true, output: `🎲 掷骰结果: ${result} (${min}-${max})` }
    }
    
    case 'echo': {
      const text = context.args.text || rest
      if (!text) {
        return { success: false, error: '请提供文本内容' }
      }
      // 解析宏
      const resolved = macrosStore.resolveMacros(text, {
        characterName: context.characterName,
        userName: context.userName,
        variables: variablesStore.getAllVariables(context.chatId),
      })
      return { success: true, output: resolved }
    }
    
    default:
      // 自定义命令
      if (command.script) {
        const resolved = macrosStore.resolveMacros(command.script, {
          characterName: context.characterName,
          userName: context.userName,
          variables: {
            ...variablesStore.getAllVariables(context.chatId),
            ...context.args,
          },
        })
        return { success: true, output: resolved }
      }
      
      return { success: false, error: `未实现的命令: ${command.name}` }
  }
}

/**
 * 检查输入是否是命令
 */
export function isCommand(input: string): boolean {
  return input.startsWith('/')
}

/**
 * 检查是否是脚本 (多行或包含管道)
 */
export function isScript(input: string): boolean {
  return input.includes('\n') || input.includes('|')
}

/**
 * 执行脚本 (支持多行和管道)
 */
export async function executeScriptCommand(
  input: string,
  context: Partial<CommandContext>,
  callbacks: CommandCallbacks
): Promise<CommandResult> {
  const result = await executeScript(input, {
    chatId: context.chatId,
    characterName: context.characterName,
    userName: context.userName,
  }, {
    callbacks: {
      onSend: callbacks.onSend,
      onContinue: callbacks.onContinue,
      onRegenerate: callbacks.onRegenerate,
      onSwipe: callbacks.onSwipe,
      onOutput: callbacks.onOutput,
    },
  })
  
  return {
    success: result.success,
    output: result.output,
    error: result.error,
    shouldSend: result.shouldSend,
    modifiedInput: result.modifiedInput,
  }
}

/**
 * 验证脚本语法
 */
export function validateScript(script: string): { valid: boolean; error?: string } {
  const result = parseScript(script)
  return {
    valid: result.success,
    error: result.error,
  }
}

/**
 * 获取命令自动补全建议
 */
export function getCommandSuggestions(partial: string): SlashCommand[] {
  return useTavernSlashCommandsStore.getState().getCompletions(partial)
}

/**
 * 格式化命令帮助
 */
export function formatCommandHelp(command: SlashCommand): string {
  let help = `/${command.name}`
  
  command.args.forEach(arg => {
    if (arg.required) {
      help += ` <${arg.name}>`
    } else {
      help += ` [${arg.name}]`
    }
  })
  
  return help
}
