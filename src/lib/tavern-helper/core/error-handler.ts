/**
 * TavernHelper 错误处理模块
 * 提供统一的错误类型、错误处理和恢复机制
 */

import type { LogLevel } from './types';
import { getLogger } from './logger';

/** 错误代码枚举 */
export enum ErrorCode {
  // 通用错误 (1xxx)
  UNKNOWN = 1000,
  INVALID_ARGUMENT = 1001,
  INVALID_STATE = 1002,
  NOT_FOUND = 1003,
  ALREADY_EXISTS = 1004,
  TIMEOUT = 1005,
  CANCELLED = 1006,

  // 变量系统错误 (2xxx)
  VARIABLE_NOT_FOUND = 2000,
  VARIABLE_SCOPE_ERROR = 2001,
  VARIABLE_TYPE_ERROR = 2002,
  VARIABLE_READONLY = 2003,

  // 消息系统错误 (3xxx)
  MESSAGE_NOT_FOUND = 3000,
  MESSAGE_INVALID_FORMAT = 3001,
  MESSAGE_OPERATION_FAILED = 3002,

  // 生成系统错误 (4xxx)
  GENERATE_FAILED = 4000,
  GENERATE_ABORTED = 4001,
  GENERATE_RATE_LIMITED = 4002,
  GENERATE_INVALID_CONFIG = 4003,

  // 宏系统错误 (5xxx)
  MACRO_NOT_FOUND = 5000,
  MACRO_PARSE_ERROR = 5001,
  MACRO_EXECUTION_ERROR = 5002,
  MACRO_CIRCULAR_REFERENCE = 5003,

  // 注入系统错误 (6xxx)
  INJECT_INVALID_POSITION = 6000,
  INJECT_CONFLICT = 6001,

  // 事件系统错误 (7xxx)
  EVENT_LISTENER_ERROR = 7000,
  EVENT_EMIT_ERROR = 7001,

  // 脚本系统错误 (8xxx)
  SCRIPT_PARSE_ERROR = 8000,
  SCRIPT_EXECUTION_ERROR = 8001,
  SCRIPT_TIMEOUT = 8002,

  // 兼容层错误 (9xxx)
  COMPAT_API_NOT_SUPPORTED = 9000,
  COMPAT_VERSION_MISMATCH = 9001,
}

/** 错误严重级别 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/** 错误上下文 */
export interface ErrorContext {
  /** 发生错误的模块 */
  module?: string;
  /** 发生错误的操作 */
  operation?: string;
  /** 相关数据 */
  data?: unknown;
  /** 原始错误 */
  cause?: Error;
  /** 是否可恢复 */
  recoverable?: boolean;
}

/**
 * TavernHelper 基础错误类
 */
export class TavernHelperError extends Error {
  /** 错误代码 */
  readonly code: ErrorCode;
  /** 严重级别 */
  readonly severity: ErrorSeverity;
  /** 错误上下文 */
  readonly context: ErrorContext;
  /** 错误发生时间 */
  readonly timestamp: number;
  /** 是否已处理 */
  handled: boolean = false;

  constructor(
    code: ErrorCode,
    message: string,
    severity: ErrorSeverity = 'medium',
    context: ErrorContext = {}
  ) {
    super(message);
    this.name = 'TavernHelperError';
    this.code = code;
    this.severity = severity;
    this.context = context;
    this.timestamp = Date.now();

    // 保留原始错误的堆栈
    if (context.cause && context.cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${context.cause.stack}`;
    }

    // 确保 instanceof 正常工作
    Object.setPrototypeOf(this, TavernHelperError.prototype);
  }

  /**
   * 获取错误的完整描述
   */
  getFullMessage(): string {
    const parts = [
      `[${ErrorCode[this.code]}] ${this.message}`,
    ];

    if (this.context.module) {
      parts.push(`Module: ${this.context.module}`);
    }
    if (this.context.operation) {
      parts.push(`Operation: ${this.context.operation}`);
    }
    if (this.context.data !== undefined) {
      parts.push(`Data: ${JSON.stringify(this.context.data)}`);
    }

    return parts.join(' | ');
  }

  /**
   * 转换为 JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      codeName: ErrorCode[this.code],
      message: this.message,
      severity: this.severity,
      context: this.context,
      timestamp: this.timestamp,
      handled: this.handled,
      stack: this.stack,
    };
  }

  /**
   * 判断是否可恢复
   */
  isRecoverable(): boolean {
    return this.context.recoverable ?? this.severity !== 'critical';
  }
}

/** 特定类型的错误类 */

export class VariableError extends TavernHelperError {
  constructor(code: ErrorCode, message: string, context?: ErrorContext) {
    super(code, message, 'medium', { ...context, module: 'variables' });
    this.name = 'VariableError';
  }
}

export class MessageError extends TavernHelperError {
  constructor(code: ErrorCode, message: string, context?: ErrorContext) {
    super(code, message, 'medium', { ...context, module: 'messages' });
    this.name = 'MessageError';
  }
}

export class GenerateError extends TavernHelperError {
  constructor(code: ErrorCode, message: string, severity: ErrorSeverity = 'high', context?: ErrorContext) {
    super(code, message, severity, { ...context, module: 'generate' });
    this.name = 'GenerateError';
  }
}

export class MacroError extends TavernHelperError {
  constructor(code: ErrorCode, message: string, context?: ErrorContext) {
    super(code, message, 'medium', { ...context, module: 'macros' });
    this.name = 'MacroError';
  }
}

export class ScriptError extends TavernHelperError {
  constructor(code: ErrorCode, message: string, context?: ErrorContext) {
    super(code, message, 'high', { ...context, module: 'script' });
    this.name = 'ScriptError';
  }
}

export class CompatError extends TavernHelperError {
  constructor(code: ErrorCode, message: string, context?: ErrorContext) {
    super(code, message, 'low', { ...context, module: 'compat' });
    this.name = 'CompatError';
  }
}

/** 错误处理器回调类型 */
export type ErrorHandler = (error: TavernHelperError) => void | Promise<void>;

/** 错误处理器配置 */
export interface ErrorHandlerConfig {
  /** 是否自动记录日志 */
  autoLog?: boolean;
  /** 是否在严重错误时抛出 */
  throwOnCritical?: boolean;
  /** 默认错误处理器 */
  defaultHandler?: ErrorHandler;
}

/**
 * 错误处理器类
 */
export class ErrorHandlerManager {
  private config: Required<ErrorHandlerConfig>;
  private handlers: Map<ErrorCode | 'all', ErrorHandler[]> = new Map();
  private errorHistory: TavernHelperError[] = [];
  private maxHistorySize = 100;

  constructor(config: ErrorHandlerConfig = {}) {
    this.config = {
      autoLog: config.autoLog ?? true,
      throwOnCritical: config.throwOnCritical ?? false,
      defaultHandler: config.defaultHandler ?? (() => {}),
    };
  }

  /**
   * 注册错误处理器
   */
  on(code: ErrorCode | 'all', handler: ErrorHandler): () => void {
    if (!this.handlers.has(code)) {
      this.handlers.set(code, []);
    }
    this.handlers.get(code)!.push(handler);

    return () => {
      const handlers = this.handlers.get(code);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * 处理错误
   */
  async handle(error: TavernHelperError): Promise<void> {
    // 记录到历史
    this.errorHistory.push(error);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }

    // 自动记录日志
    if (this.config.autoLog) {
      const logger = getLogger();
      const logLevel: LogLevel = error.severity === 'critical' || error.severity === 'high'
        ? 'error'
        : error.severity === 'medium'
          ? 'warn'
          : 'info';

      logger[logLevel](error.getFullMessage(), error.toJSON(), error.context.module);
    }

    // 调用特定错误处理器
    const specificHandlers = this.handlers.get(error.code) || [];
    for (const handler of specificHandlers) {
      try {
        await handler(error);
      } catch (e) {
        console.error('[TavernHelper ErrorHandler] Handler error:', e);
      }
    }

    // 调用通用错误处理器
    const allHandlers = this.handlers.get('all') || [];
    for (const handler of allHandlers) {
      try {
        await handler(error);
      } catch (e) {
        console.error('[TavernHelper ErrorHandler] Handler error:', e);
      }
    }

    // 调用默认处理器
    try {
      await this.config.defaultHandler(error);
    } catch (e) {
      console.error('[TavernHelper ErrorHandler] Default handler error:', e);
    }

    // 标记为已处理
    error.handled = true;

    // 严重错误抛出
    if (this.config.throwOnCritical && error.severity === 'critical') {
      throw error;
    }
  }

  /**
   * 同步处理错误
   */
  handleSync(error: TavernHelperError): void {
    // 记录到历史
    this.errorHistory.push(error);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }

    // 自动记录日志
    if (this.config.autoLog) {
      const logger = getLogger();
      const logLevel: LogLevel = error.severity === 'critical' || error.severity === 'high'
        ? 'error'
        : error.severity === 'medium'
          ? 'warn'
          : 'info';

      logger[logLevel](error.getFullMessage(), error.toJSON(), error.context.module);
    }

    // 标记为已处理
    error.handled = true;

    // 严重错误抛出
    if (this.config.throwOnCritical && error.severity === 'critical') {
      throw error;
    }
  }

  /**
   * 获取错误历史
   */
  getHistory(options?: {
    code?: ErrorCode;
    severity?: ErrorSeverity;
    module?: string;
    limit?: number;
  }): TavernHelperError[] {
    let result = [...this.errorHistory];

    if (options?.code !== undefined) {
      result = result.filter((e) => e.code === options.code);
    }
    if (options?.severity) {
      result = result.filter((e) => e.severity === options.severity);
    }
    if (options?.module) {
      result = result.filter((e) => e.context.module === options.module);
    }
    if (options?.limit) {
      result = result.slice(-options.limit);
    }

    return result;
  }

  /**
   * 清空错误历史
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalErrors: number;
    byCode: Record<string, number>;
    bySeverity: Record<ErrorSeverity, number>;
    byModule: Record<string, number>;
  } {
    const byCode: Record<string, number> = {};
    const bySeverity: Record<ErrorSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    const byModule: Record<string, number> = {};

    for (const error of this.errorHistory) {
      const codeName = ErrorCode[error.code];
      byCode[codeName] = (byCode[codeName] || 0) + 1;
      bySeverity[error.severity]++;
      if (error.context.module) {
        byModule[error.context.module] = (byModule[error.context.module] || 0) + 1;
      }
    }

    return {
      totalErrors: this.errorHistory.length,
      byCode,
      bySeverity,
      byModule,
    };
  }
}

/** 全局错误处理器单例 */
let globalErrorHandler: ErrorHandlerManager | null = null;

/**
 * 获取全局错误处理器实例
 */
export function getErrorHandler(): ErrorHandlerManager {
  if (!globalErrorHandler) {
    globalErrorHandler = new ErrorHandlerManager();
  }
  return globalErrorHandler;
}

/**
 * 初始化全局错误处理器（可配置）
 */
export function initErrorHandler(config?: ErrorHandlerConfig): ErrorHandlerManager {
  globalErrorHandler = new ErrorHandlerManager(config);
  return globalErrorHandler;
}

/**
 * 重置全局错误处理器（主要用于测试）
 */
export function resetErrorHandler(): void {
  if (globalErrorHandler) {
    globalErrorHandler.clearHistory();
  }
  globalErrorHandler = null;
}

/**
 * 创建并处理错误的便捷函数
 */
export function createError(
  code: ErrorCode,
  message: string,
  severity?: ErrorSeverity,
  context?: ErrorContext
): TavernHelperError {
  const error = new TavernHelperError(code, message, severity, context);
  getErrorHandler().handleSync(error);
  return error;
}

/**
 * 包装函数以捕获错误
 */
export function wrapWithErrorHandler<T extends (...args: unknown[]) => unknown>(
  fn: T,
  context: Omit<ErrorContext, 'cause'>
): T {
  return ((...args: unknown[]) => {
    try {
      const result = fn(...args);
      
      // 处理 Promise
      if (result instanceof Promise) {
        return result.catch((error) => {
          const wrappedError = new TavernHelperError(
            ErrorCode.UNKNOWN,
            error.message || 'Unknown error',
            'medium',
            { ...context, cause: error }
          );
          getErrorHandler().handleSync(wrappedError);
          throw wrappedError;
        });
      }
      
      return result;
    } catch (error) {
      const wrappedError = new TavernHelperError(
        ErrorCode.UNKNOWN,
        (error as Error).message || 'Unknown error',
        'medium',
        { ...context, cause: error as Error }
      );
      getErrorHandler().handleSync(wrappedError);
      throw wrappedError;
    }
  }) as T;
}

/**
 * 尝试执行操作，失败时返回默认值
 */
export function tryOrDefault<T>(
  fn: () => T,
  defaultValue: T,
  context?: Omit<ErrorContext, 'cause'>
): T {
  try {
    return fn();
  } catch (error) {
    if (context) {
      const wrappedError = new TavernHelperError(
        ErrorCode.UNKNOWN,
        (error as Error).message || 'Unknown error',
        'low',
        { ...context, cause: error as Error, recoverable: true }
      );
      getErrorHandler().handleSync(wrappedError);
    }
    return defaultValue;
  }
}

/**
 * 异步尝试执行操作，失败时返回默认值
 */
export async function tryOrDefaultAsync<T>(
  fn: () => Promise<T>,
  defaultValue: T,
  context?: Omit<ErrorContext, 'cause'>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (context) {
      const wrappedError = new TavernHelperError(
        ErrorCode.UNKNOWN,
        (error as Error).message || 'Unknown error',
        'low',
        { ...context, cause: error as Error, recoverable: true }
      );
      getErrorHandler().handleSync(wrappedError);
    }
    return defaultValue;
  }
}
