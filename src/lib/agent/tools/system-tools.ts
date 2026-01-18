import { Tool, ToolResult } from '../types'

export const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: '获取当前的日期和时间。返回格式：YYYY-MM-DD（例如：2026-01-18），这个格式适合直接用作文件名的一部分。',
  category: 'system',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      console.log('[get_current_time] 开始执行')

      const now = new Date()

      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')

      // 安全的文件名格式：YYYY-MM-DD
      const safeFileNameDate = `${year}-${month}-${day}`

      console.log('[get_current_time] 获取成功', { safeFileNameDate })

      return {
        success: true,
        data: safeFileNameDate,
        message: `当前日期：${safeFileNameDate}`,
      }
    } catch (error) {
      console.error('[get_current_time] 获取失败', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `获取时间失败: ${error}`,
      }
    }
  },
}

export const systemTools: Tool[] = [
  getCurrentTimeTool,
]
