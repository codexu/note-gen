/**
 * 调试日志系统
 * 用于收集和分析 Tavern 模块的运行日志
 * 包括上下文构建、Token 使用、世界书扫描等
 */

// ============================================================================
// Types
// ============================================================================

/**
 * 日志级别
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * 日志类别
 */
export enum LogCategory {
  CONTEXT_BUILD = 'context_build',
  WORLD_INFO = 'world_info',
  TOKEN_BUDGET = 'token_budget',
  MEMORY = 'memory',
  TOOL_CALL = 'tool_call',
  GROUP_CHAT = 'group_chat',
  TEMPLATE = 'template',
  GENERAL = 'general',
}

/**
 * 日志条目
 */
export interface LogEntry {
  id: string
  timestamp: number
  level: LogLevel
  category: LogCategory
  message: string
  data?: Record<string, unknown>
  duration?: number
}

/**
 * Token 使用明细
 */
export interface TokenUsageDetail {
  section: string
  tokens: number
  percentage: number
  content?: string
}

/**
 * Token 使用报告
 */
export interface TokenUsageReport {
  timestamp: number
  maxContext: number
  usedTokens: number
  remainingTokens: number
  utilizationRate: number
  details: TokenUsageDetail[]
}

/**
 * 上下文构建报告
 */
export interface ContextBuildReport {
  timestamp: number
  duration: number
  cardName: string
  personaName: string
  messageCount: number
  worldInfoCount: number
  tokenReport: TokenUsageReport
  logs: LogEntry[]
}

/**
 * 日志配置
 */
export interface DebugLoggerConfig {
  enabled: boolean
  level: LogLevel
  maxLogs: number
  persistLogs: boolean
  categories: LogCategory[]
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: DebugLoggerConfig = {
  enabled: false,
  level: LogLevel.INFO,
  maxLogs: 1000,
  persistLogs: false,
  categories: Object.values(LogCategory) as LogCategory[],
}

// ============================================================================
// Debug Logger
// ============================================================================

/**
 * 调试日志器
 */
export class DebugLogger {
  private config: DebugLoggerConfig
  private logs: LogEntry[] = []
  private tokenReports: TokenUsageReport[] = []
  private contextReports: ContextBuildReport[] = []
  private timers: Map<string, number> = new Map()

  constructor(config: Partial<DebugLoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 启用日志
   */
  enable(): void {
    this.config.enabled = true
  }

  /**
   * 禁用日志
   */
  disable(): void {
    this.config.enabled = false
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.config.level = level
  }

  /**
   * 记录日志
   */
  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (!this.config.enabled) return
    if (level < this.config.level) return
    if (!this.config.categories.includes(category)) return

    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
    }

    this.logs.push(entry)

    // 限制日志数量
    while (this.logs.length > this.config.maxLogs) {
      this.logs.shift()
    }

    // 控制台输出
    this.consoleOutput(entry)
  }

  /**
   * 调试日志
   */
  debug(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, category, message, data)
  }

  /**
   * 信息日志
   */
  info(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, category, message, data)
  }

  /**
   * 警告日志
   */
  warn(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, category, message, data)
  }

  /**
   * 错误日志
   */
  error(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, category, message, data)
  }

  /**
   * 开始计时
   */
  startTimer(name: string): void {
    this.timers.set(name, performance.now())
  }

  /**
   * 结束计时并记录
   */
  endTimer(name: string, category: LogCategory, message?: string): number {
    const startTime = this.timers.get(name)
    if (!startTime) return 0

    const duration = performance.now() - startTime
    this.timers.delete(name)

    this.info(category, message || `${name} 完成`, { duration: `${duration.toFixed(2)}ms` })

    return duration
  }

  /**
   * 记录 Token 使用报告
   */
  recordTokenUsage(report: Omit<TokenUsageReport, 'timestamp'>): void {
    const fullReport: TokenUsageReport = {
      ...report,
      timestamp: Date.now(),
    }

    this.tokenReports.push(fullReport)

    // 限制报告数量
    while (this.tokenReports.length > 50) {
      this.tokenReports.shift()
    }

    this.info(LogCategory.TOKEN_BUDGET, 'Token 使用报告', {
      used: report.usedTokens,
      max: report.maxContext,
      rate: `${(report.utilizationRate * 100).toFixed(1)}%`,
    })
  }

  /**
   * 记录上下文构建报告
   */
  recordContextBuild(report: Omit<ContextBuildReport, 'timestamp' | 'logs'>): void {
    const fullReport: ContextBuildReport = {
      ...report,
      timestamp: Date.now(),
      logs: this.getRecentLogs(LogCategory.CONTEXT_BUILD, 50),
    }

    this.contextReports.push(fullReport)

    // 限制报告数量
    while (this.contextReports.length > 20) {
      this.contextReports.shift()
    }

    this.info(LogCategory.CONTEXT_BUILD, '上下文构建完成', {
      card: report.cardName,
      messages: report.messageCount,
      worldInfo: report.worldInfoCount,
      duration: `${report.duration.toFixed(2)}ms`,
    })
  }

  /**
   * 获取所有日志
   */
  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  /**
   * 获取最近的日志
   */
  getRecentLogs(category?: LogCategory, count = 100): LogEntry[] {
    let filtered = this.logs
    if (category) {
      filtered = this.logs.filter(l => l.category === category)
    }
    return filtered.slice(-count)
  }

  /**
   * 获取 Token 使用报告
   */
  getTokenReports(): TokenUsageReport[] {
    return [...this.tokenReports]
  }

  /**
   * 获取上下文构建报告
   */
  getContextReports(): ContextBuildReport[] {
    return [...this.contextReports]
  }

  /**
   * 获取最新的 Token 报告
   */
  getLatestTokenReport(): TokenUsageReport | undefined {
    return this.tokenReports[this.tokenReports.length - 1]
  }

  /**
   * 获取最新的上下文报告
   */
  getLatestContextReport(): ContextBuildReport | undefined {
    return this.contextReports[this.contextReports.length - 1]
  }

  /**
   * 清除日志
   */
  clearLogs(): void {
    this.logs = []
  }

  /**
   * 清除所有数据
   */
  clearAll(): void {
    this.logs = []
    this.tokenReports = []
    this.contextReports = []
    this.timers.clear()
  }

  /**
   * 导出日志为 JSON
   */
  exportLogs(): string {
    return JSON.stringify({
      logs: this.logs,
      tokenReports: this.tokenReports,
      contextReports: this.contextReports,
      exportedAt: Date.now(),
    }, null, 2)
  }

  /**
   * 导出 Token 使用明细
   */
  exportTokenDetails(): string {
    const report = this.getLatestTokenReport()
    if (!report) return ''

    let output = `# Token 使用报告\n`
    output += `时间: ${new Date(report.timestamp).toLocaleString()}\n`
    output += `总预算: ${report.maxContext}\n`
    output += `已使用: ${report.usedTokens}\n`
    output += `剩余: ${report.remainingTokens}\n`
    output += `利用率: ${(report.utilizationRate * 100).toFixed(1)}%\n\n`
    output += `## 明细\n`

    for (const detail of report.details) {
      output += `- ${detail.section}: ${detail.tokens} (${(detail.percentage * 100).toFixed(1)}%)\n`
    }

    return output
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  /**
   * 控制台输出
   */
  private consoleOutput(entry: LogEntry): void {
    const prefix = `[Tavern:${entry.category}]`
    
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(prefix, entry.message, entry.data || '')
        break
      case LogLevel.INFO:
        console.info(prefix, entry.message, entry.data || '')
        break
      case LogLevel.WARN:
        console.warn(prefix, entry.message, entry.data || '')
        break
      case LogLevel.ERROR:
        console.error(prefix, entry.message, entry.data || '')
        break
    }
  }
}

// ============================================================================
// Token 统计工具
// ============================================================================

/**
 * Token 统计器
 * 用于跟踪各部分的 Token 使用情况
 */
export class TokenTracker {
  private sections: Map<string, { tokens: number; content?: string }> = new Map()
  private maxTokens: number

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens
  }

  /**
   * 添加 Token 使用
   */
  add(section: string, tokens: number, content?: string): void {
    const existing = this.sections.get(section)
    if (existing) {
      existing.tokens += tokens
      if (content) {
        existing.content = (existing.content || '') + content
      }
    } else {
      this.sections.set(section, { tokens, content })
    }
  }

  /**
   * 设置 Token 使用
   */
  set(section: string, tokens: number, content?: string): void {
    this.sections.set(section, { tokens, content })
  }

  /**
   * 获取总使用量
   */
  getTotal(): number {
    let total = 0
    for (const { tokens } of this.sections.values()) {
      total += tokens
    }
    return total
  }

  /**
   * 获取剩余量
   */
  getRemaining(): number {
    return Math.max(0, this.maxTokens - this.getTotal())
  }

  /**
   * 获取利用率
   */
  getUtilization(): number {
    return this.getTotal() / this.maxTokens
  }

  /**
   * 生成报告
   */
  generateReport(): TokenUsageReport {
    const total = this.getTotal()
    const details: TokenUsageDetail[] = []

    for (const [section, { tokens, content }] of this.sections.entries()) {
      details.push({
        section,
        tokens,
        percentage: total > 0 ? tokens / total : 0,
        content,
      })
    }

    // 按 Token 数量排序
    details.sort((a, b) => b.tokens - a.tokens)

    return {
      timestamp: Date.now(),
      maxContext: this.maxTokens,
      usedTokens: total,
      remainingTokens: this.getRemaining(),
      utilizationRate: this.getUtilization(),
      details,
    }
  }

  /**
   * 重置
   */
  reset(): void {
    this.sections.clear()
  }
}

// ============================================================================
// 全局实例
// ============================================================================

/** 全局调试日志器 */
export const tavernDebugLogger = new DebugLogger()

/**
 * 便捷函数: 创建 Token 跟踪器
 */
export function createTokenTracker(maxTokens: number): TokenTracker {
  return new TokenTracker(maxTokens)
}
