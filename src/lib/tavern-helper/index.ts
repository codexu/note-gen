/**
 * TavernHelper - NoteGen 原生 Tavern 辅助系统
 * 
 * 提供与 SillyTavern JS-Slash-Runner 兼容的 API，
 * 包括变量系统、消息操作、AI 生成、宏系统、提示注入等功能。
 * 
 * @example
 * ```typescript
 * import { TavernHelper } from '$lib/tavern-helper';
 * 
 * // 使用事件系统
 * TavernHelper.events.on('message:sent', (data) => {
 *   console.log('Message sent:', data);
 * });
 * 
 * // 使用日志系统
 * TavernHelper.log.info('Hello from TavernHelper');
 * ```
 */

// 导出核心模块
export * from './core';

// 导出变量模块
export * from './variables';

// 导出消息模块
export * from './messages';

// 导出生成模块
export * from './generate';

// 导出宏模块
export * from './macros';

// 导出注入模块
export * from './inject';

// 导出兼容层模块
export * from './compat';

// 导入核心模块
import { TAVERN_HELPER_VERSION } from './core/types';
import { getEventBus } from './core/event-bus';
import { getLogger, log } from './core/logger';
import { getErrorHandler } from './core/error-handler';
import { getVariableManager } from './variables';
import { getMessageManager } from './messages';
import { getGenerateManager } from './generate';
import { getMacroManager } from './macros';
import { getInjectManager } from './inject';
import { createSTCompatAPI, installSTCompat } from './compat';

/**
 * TavernHelper 全局对象
 * 提供统一的 API 入口
 */
export const TavernHelper = {
  /** 版本信息 */
  version: TAVERN_HELPER_VERSION,
  
  /** 获取事件总线 */
  get events() {
    return getEventBus();
  },
  
  /** 获取日志器 */
  get log() {
    return log;
  },
  
  /** 获取日志器实例 */
  get logger() {
    return getLogger();
  },
  
  /** 获取错误处理器 */
  get errors() {
    return getErrorHandler();
  },
  
  /** 获取变量管理器 */
  get variables() {
    return getVariableManager();
  },
  
  /** 获取消息管理器 */
  get messages() {
    return getMessageManager();
  },
  
  /** 获取生成管理器 */
  get generate() {
    return getGenerateManager();
  },
  
  /** 获取宏管理器 */
  get macros() {
    return getMacroManager();
  },
  
  /** 获取注入管理器 */
  get inject() {
    return getInjectManager();
  },
  
  /** 获取 SillyTavern 兼容 API */
  get compat() {
    return createSTCompatAPI();
  },
  
  /** 安装兼容层到目标对象 */
  installCompat: installSTCompat,
};

// 默认导出
export default TavernHelper;
