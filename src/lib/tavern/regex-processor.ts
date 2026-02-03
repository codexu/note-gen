import { getRegexScripts, TavernRegex } from '@/db/tavern'

/**
 * 正则脚本应用位置
 */
export enum RegexPlacement {
  AI_OUTPUT = 'AI_OUTPUT',         // AI 响应输出
  USER_INPUT = 'USER_INPUT',       // 用户输入
  SLASH_COMMAND = 'SLASH_COMMAND', // 斜杠命令
  WORLD_INFO = 'WORLD_INFO',       // 世界书内容
  PROMPT = 'PROMPT',               // 发送给 AI 的提示词
}

/**
 * 正则处理器配置
 */
export interface RegexProcessorConfig {
  cardId?: number          // 角色卡 ID（加载角色绑定的正则）
  presetId?: number        // 预设 ID（加载预设绑定的正则）
  placement: RegexPlacement // 应用位置
  depth?: number           // 消息深度（用于深度过滤）
}

/**
 * 正则脚本处理器
 * 
 * 功能：
 * - 加载和缓存正则脚本
 * - 按位置和深度过滤脚本
 * - 执行正则替换
 * - 支持裁剪字符串
 */
export class RegexProcessor {
  private scripts: TavernRegex[] = []
  private loaded = false

  constructor(private config: RegexProcessorConfig) {}

  /**
   * 加载正则脚本
   */
  async loadScripts(): Promise<void> {
    if (this.loaded) return

    try {
      // 加载全局脚本和绑定的脚本
      this.scripts = await getRegexScripts(this.config.cardId, this.config.presetId)
      this.loaded = true
    } catch (error) {
      console.error('加载正则脚本失败:', error)
      this.scripts = []
    }
  }

  /**
   * 处理文本
   */
  async process(text: string, isMarkdown = false): Promise<string> {
    if (!text) return text

    await this.loadScripts()

    let result = text

    for (const script of this.scripts) {
      // 跳过禁用的脚本
      if (script.disabled) continue

      // 检查位置匹配
      const placements: string[] = JSON.parse(script.placement || '[]')
      if (placements.length > 0 && !placements.includes(this.config.placement)) {
        continue
      }

      // 检查深度过滤
      if (this.config.depth !== undefined) {
        if (script.minDepth !== null && this.config.depth < script.minDepth) continue
        if (script.maxDepth !== null && this.config.depth > script.maxDepth) continue
      }

      // 检查 markdown 限制
      if (script.markdownOnly && !isMarkdown) continue

      // 检查 prompt 限制
      if (script.promptOnly && this.config.placement !== RegexPlacement.PROMPT) continue

      // 执行替换
      result = this.executeScript(result, script)
    }

    return result
  }

  /**
   * 执行单个脚本
   */
  private executeScript(text: string, script: TavernRegex): string {
    try {
      // 构建正则表达式
      let flags = 'g' // 全局匹配
      if (!script.findRegex.includes('(?i)')) {
        flags += 'i' // 默认不区分大小写
      }

      const regex = new RegExp(script.findRegex, flags)

      // 执行替换
      let result: string
      if (script.substituteRegex) {
        // 使用替换字符串中的 $1, $2 等
        result = text.replace(regex, script.replaceString)
      } else {
        // 简单替换
        result = text.replace(regex, script.replaceString)
      }

      // 执行裁剪
      const trimStrings: string[] = JSON.parse(script.trimStrings || '[]')
      for (const trimStr of trimStrings) {
        if (trimStr) {
          // 裁剪掉匹配的字符串
          result = result.split(trimStr).join('')
        }
      }

      return result
    } catch (error) {
      console.warn(`正则脚本执行失败 [${script.name}]:`, error)
      return text
    }
  }

  /**
   * 重新加载脚本
   */
  async reload(): Promise<void> {
    this.loaded = false
    await this.loadScripts()
  }

  /**
   * 获取已加载的脚本数量
   */
  getScriptCount(): number {
    return this.scripts.length
  }
}

/**
 * 处理 AI 输出
 */
export async function processAIOutput(
  text: string,
  cardId?: number,
  depth?: number
): Promise<string> {
  const processor = new RegexProcessor({
    cardId,
    placement: RegexPlacement.AI_OUTPUT,
    depth,
  })
  return await processor.process(text, true)
}

/**
 * 处理用户输入
 */
export async function processUserInput(
  text: string,
  cardId?: number
): Promise<string> {
  const processor = new RegexProcessor({
    cardId,
    placement: RegexPlacement.USER_INPUT,
  })
  return await processor.process(text)
}

/**
 * 处理发送给 AI 的提示词
 */
export async function processPrompt(
  text: string,
  cardId?: number,
  presetId?: number
): Promise<string> {
  const processor = new RegexProcessor({
    cardId,
    presetId,
    placement: RegexPlacement.PROMPT,
  })
  return await processor.process(text)
}

/**
 * 内置的常用正则处理函数
 */
export const BuiltInRegex = {
  /**
   * 移除 AI 角色扮演中的 OOC (Out of Character) 内容
   */
  removeOOC(text: string): string {
    // 移除 (( )) 或 [[ ]] 包裹的内容
    return text
      .replace(/\(\([^)]*\)\)/g, '')
      .replace(/\[\[[^\]]*\]\]/g, '')
      .trim()
  },

  /**
   * 移除 AI 输出中的用户名前缀
   */
  removeUserPrefix(text: string, userName: string): string {
    const regex = new RegExp(`^${escapeRegex(userName)}:\\s*`, 'gim')
    return text.replace(regex, '').trim()
  },

  /**
   * 格式化动作标记 *action* 为斜体
   */
  formatActions(text: string): string {
    return text.replace(/\*([^*]+)\*/g, '_$1_')
  },

  /**
   * 移除多余的空行
   */
  normalizeWhitespace(text: string): string {
    return text
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  },
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
