/**
 * TavernHelper 核心模块
 * 导出所有核心功能：类型定义、事件总线、日志、错误处理
 */

// 类型定义
export * from './types';

// 事件总线
export {
  EventBus,
  ScopedEventBus,
  getEventBus,
  initEventBus,
  resetEventBus,
  type EventBusConfig,
} from './event-bus';

// 日志系统
export {
  Logger,
  SourcedLogger,
  LogGroup,
  getLogger,
  initLogger,
  resetLogger,
  log,
  type LoggerConfig,
} from './logger';

// 错误处理
export {
  ErrorCode,
  TavernHelperError,
  VariableError,
  MessageError,
  GenerateError,
  MacroError,
  ScriptError,
  CompatError,
  ErrorHandlerManager,
  getErrorHandler,
  initErrorHandler,
  resetErrorHandler,
  createError,
  wrapWithErrorHandler,
  tryOrDefault,
  tryOrDefaultAsync,
  type ErrorSeverity,
  type ErrorContext,
  type ErrorHandler,
  type ErrorHandlerConfig,
} from './error-handler';
