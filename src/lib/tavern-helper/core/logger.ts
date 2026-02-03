/**
 * TavernHelper 日志系统
 * 提供分级日志、历史记录、格式化输出
 */

import type { LogEntry, LogLevel } from './types';

/** 日志配置 */
export interface LoggerConfig {
  /** 最小日志级别 */
  level?: LogLevel;
  /** 是否启用控制台输出 */
  console?: boolean;
  /** 最大历史记录数量 */
  maxHistory?: number;
  /** 日志前缀 */
  prefix?: string;
  /** 是否包含时间戳 */
  timestamp?: boolean;
}

/** 日志级别优先级（数字越小优先级越高） */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 日志级别对应的控制台方法 */
const LOG_LEVEL_CONSOLE_METHOD: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/** 日志级别对应的样式（用于控制台） */
const LOG_LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'color: #888',
  info: 'color: #2196F3',
  warn: 'color: #FF9800',
  error: 'color: #F44336; font-weight: bold',
};

/**
 * Logger 类
 */
export class Logger {
  private config: Required<LoggerConfig>;
  private history: LogEntry[] = [];
  private listeners: Array<(entry: LogEntry) => void> = [];

  constructor(config: LoggerConfig = {}) {
    this.config = {
      level: config.level ?? 'info',
      console: config.console ?? true,
      maxHistory: config.maxHistory ?? 500,
      prefix: config.prefix ?? 'TavernHelper',
      timestamp: config.timestamp ?? true,
    };
  }

  /**
   * 检查是否应该记录该级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(level: LogLevel, message: string): string {
    const parts: string[] = [];
    
    if (this.config.timestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }
    
    parts.push(`[${this.config.prefix}]`);
    parts.push(`[${level.toUpperCase()}]`);
    parts.push(message);
    
    return parts.join(' ');
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, message: string, data?: unknown, source?: string): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      data,
      source,
      timestamp: Date.now(),
    };

    // 添加到历史记录
    this.history.push(entry);
    if (this.history.length > this.config.maxHistory) {
      this.history.shift();
    }

    // 通知监听器
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (e) {
        // 忽略监听器错误
      }
    }

    // 控制台输出
    if (this.config.console) {
      const formattedMessage = this.formatMessage(level, message);
      const consoleMethod = LOG_LEVEL_CONSOLE_METHOD[level];
      const style = LOG_LEVEL_STYLES[level];

      if (data !== undefined) {
        console[consoleMethod](`%c${formattedMessage}`, style, data);
      } else {
        console[consoleMethod](`%c${formattedMessage}`, style);
      }
    }
  }

  /**
   * 调试日志
   */
  debug(message: string, data?: unknown, source?: string): void {
    this.log('debug', message, data, source);
  }

  /**
   * 信息日志
   */
  info(message: string, data?: unknown, source?: string): void {
    this.log('info', message, data, source);
  }

  /**
   * 警告日志
   */
  warn(message: string, data?: unknown, source?: string): void {
    this.log('warn', message, data, source);
  }

  /**
   * 错误日志
   */
  error(message: string, data?: unknown, source?: string): void {
    this.log('error', message, data, source);
  }

  /**
   * 创建带有指定来源的子 Logger
   */
  withSource(source: string): SourcedLogger {
    return new SourcedLogger(this, source);
  }

  /**
   * 获取日志历史记录
   */
  getHistory(options?: {
    level?: LogLevel;
    source?: string;
    limit?: number;
    since?: number;
  }): LogEntry[] {
    let result = [...this.history];

    if (options?.level) {
      const minPriority = LOG_LEVEL_PRIORITY[options.level];
      result = result.filter((e) => LOG_LEVEL_PRIORITY[e.level] >= minPriority);
    }

    if (options?.source) {
      result = result.filter((e) => e.source === options.source);
    }

    if (options?.since !== undefined) {
      const since = options.since;
      result = result.filter((e) => e.timestamp >= since);
    }

    if (options?.limit) {
      result = result.slice(-options.limit);
    }

    return result;
  }

  /**
   * 清空日志历史
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * 添加日志监听器
   */
  addListener(listener: (entry: LogEntry) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * 启用/禁用控制台输出
   */
  setConsoleOutput(enabled: boolean): void {
    this.config.console = enabled;
  }

  /**
   * 导出日志历史为 JSON 字符串
   */
  exportHistory(): string {
    return JSON.stringify(this.history, null, 2);
  }

  /**
   * 格式化日志历史为可读文本
   */
  formatHistory(options?: { level?: LogLevel; limit?: number }): string {
    const entries = this.getHistory(options);
    return entries
      .map((e) => {
        const time = new Date(e.timestamp).toISOString();
        const source = e.source ? ` [${e.source}]` : '';
        const data = e.data !== undefined ? ` ${JSON.stringify(e.data)}` : '';
        return `${time} [${e.level.toUpperCase()}]${source} ${e.message}${data}`;
      })
      .join('\n');
  }

  /**
   * 创建分组日志
   */
  group(label: string): LogGroup {
    return new LogGroup(this, label);
  }

  /**
   * 计时器：开始
   */
  time(label: string): () => void {
    const start = performance.now();
    this.debug(`Timer started: ${label}`);
    
    return () => {
      const duration = performance.now() - start;
      this.debug(`Timer ended: ${label}`, { duration: `${duration.toFixed(2)}ms` });
    };
  }

  /**
   * 断言：如果条件为 false 则记录错误
   */
  assert(condition: boolean, message: string, data?: unknown): void {
    if (!condition) {
      this.error(`Assertion failed: ${message}`, data);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalLogs: number;
    byLevel: Record<LogLevel, number>;
    bySource: Record<string, number>;
  } {
    const byLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    const bySource: Record<string, number> = {};

    for (const entry of this.history) {
      byLevel[entry.level]++;
      if (entry.source) {
        bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      }
    }

    return {
      totalLogs: this.history.length,
      byLevel,
      bySource,
    };
  }
}

/**
 * 带固定来源的 Logger 代理
 */
export class SourcedLogger {
  constructor(
    private logger: Logger,
    private source: string
  ) {}

  debug(message: string, data?: unknown): void {
    this.logger.debug(message, data, this.source);
  }

  info(message: string, data?: unknown): void {
    this.logger.info(message, data, this.source);
  }

  warn(message: string, data?: unknown): void {
    this.logger.warn(message, data, this.source);
  }

  error(message: string, data?: unknown): void {
    this.logger.error(message, data, this.source);
  }

  time(label: string): () => void {
    return this.logger.time(`${this.source}:${label}`);
  }

  assert(condition: boolean, message: string, data?: unknown): void {
    this.logger.assert(condition, `[${this.source}] ${message}`, data);
  }
}

/**
 * 日志分组
 */
export class LogGroup {
  private entries: LogEntry[] = [];

  constructor(
    private logger: Logger,
    private label: string
  ) {
    if (typeof console.group === 'function') {
      console.group(label);
    }
  }

  debug(message: string, data?: unknown): this {
    this.logger.debug(message, data, this.label);
    return this;
  }

  info(message: string, data?: unknown): this {
    this.logger.info(message, data, this.label);
    return this;
  }

  warn(message: string, data?: unknown): this {
    this.logger.warn(message, data, this.label);
    return this;
  }

  error(message: string, data?: unknown): this {
    this.logger.error(message, data, this.label);
    return this;
  }

  end(): void {
    if (typeof console.groupEnd === 'function') {
      console.groupEnd();
    }
  }
}

/** 全局 Logger 单例 */
let globalLogger: Logger | null = null;

/**
 * 获取全局 Logger 实例
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
  }
  return globalLogger;
}

/**
 * 初始化全局 Logger（可配置）
 */
export function initLogger(config?: LoggerConfig): Logger {
  globalLogger = new Logger(config);
  return globalLogger;
}

/**
 * 重置全局 Logger（主要用于测试）
 */
export function resetLogger(): void {
  if (globalLogger) {
    globalLogger.clearHistory();
  }
  globalLogger = null;
}

/**
 * 快捷日志函数
 */
export const log = {
  debug: (message: string, data?: unknown, source?: string) =>
    getLogger().debug(message, data, source),
  info: (message: string, data?: unknown, source?: string) =>
    getLogger().info(message, data, source),
  warn: (message: string, data?: unknown, source?: string) =>
    getLogger().warn(message, data, source),
  error: (message: string, data?: unknown, source?: string) =>
    getLogger().error(message, data, source),
};
