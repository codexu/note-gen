/**
 * TavernHelper 宏管理器
 * 提供宏注册、自定义宏、优先级管理
 */

import type { MacroContext, MacroHandler, MacroDefinition } from '../core/types';
import { getMacroProcessor, type BuiltinMacroName } from './processor';
import { getLogger } from '../core/logger';

/** 简化的宏注册选项 */
export interface RegisterMacroOptions {
  /** 宏名称 */
  name: string;
  /** 匹配模式（字符串或正则） */
  pattern: string | RegExp;
  /** 处理函数 */
  handler: MacroHandler;
  /** 优先级（越高越先执行） */
  priority?: number;
  /** 描述 */
  description?: string;
}

/**
 * 宏管理器类
 */
export class MacroManager {
  private logger = getLogger().withSource('MacroManager');
  private customMacros: Set<string> = new Set();

  /**
   * 获取处理器
   */
  private get processor() {
    return getMacroProcessor();
  }

  /**
   * 注册自定义宏
   */
  register(options: RegisterMacroOptions): () => void {
    const pattern = typeof options.pattern === 'string'
      ? new RegExp(options.pattern, 'gi')
      : options.pattern;

    const macro: MacroDefinition = {
      name: options.name,
      pattern,
      handler: options.handler,
      priority: options.priority,
      description: options.description,
    };

    this.processor.register(macro);
    this.customMacros.add(options.name.toLowerCase());
    this.logger.info(`Custom macro registered: ${options.name}`);

    // 返回取消注册函数
    return () => this.unregister(options.name);
  }

  /**
   * 注册简单替换宏
   */
  registerSimple(name: string, replacement: string | (() => string)): () => void {
    return this.register({
      name,
      pattern: `\\{\\{${name}\\}\\}`,
      handler: () => typeof replacement === 'function' ? replacement() : replacement,
    });
  }

  /**
   * 注册带参数的宏
   */
  registerWithArgs(
    name: string,
    handler: (args: string[]) => string | Promise<string>,
    argCount = 1
  ): () => void {
    // 构建匹配参数的正则
    const argPatterns = Array(argCount).fill('([^:}]*)').join('::');
    const pattern = `\\{\\{${name}::${argPatterns}\\}\\}`;

    return this.register({
      name,
      pattern,
      handler: (ctx, match, ...args) => handler(args),
    });
  }

  /**
   * 注销宏
   */
  unregister(name: string): boolean {
    const result = this.processor.unregister(name);
    if (result) {
      this.customMacros.delete(name.toLowerCase());
      this.logger.info(`Macro unregistered: ${name}`);
    }
    return result;
  }

  /**
   * 注销所有自定义宏
   */
  unregisterAll(): number {
    let count = 0;
    Array.from(this.customMacros).forEach((name) => {
      if (this.processor.unregister(name)) {
        count++;
      }
    });
    this.customMacros.clear();
    this.logger.info(`Unregistered ${count} custom macros`);
    return count;
  }

  /**
   * 处理文本中的宏
   */
  async process(text: string, context?: Partial<MacroContext>): Promise<string> {
    return this.processor.process(text, context);
  }

  /**
   * 同步处理文本中的宏（简单宏）
   */
  processSync(text: string, context?: Partial<MacroContext>): string {
    // 注意：这个方法只适用于同步宏，异步宏会返回 Promise 字符串
    let result = text;
    
    // 简单替换一些常见的同步宏
    const simpleReplacements: Record<string, () => string> = {
      '{{time}}': () => new Date().toLocaleTimeString(),
      '{{date}}': () => new Date().toLocaleDateString(),
      '{{datetime}}': () => new Date().toLocaleString(),
      '{{newline}}': () => '\n',
      '{{tab}}': () => '\t',
    };

    for (const [pattern, fn] of Object.entries(simpleReplacements)) {
      result = result.split(pattern).join(fn());
    }

    return result;
  }

  /**
   * 检查文本是否包含宏
   */
  hasMacros(text: string): boolean {
    return this.processor.hasMacros(text);
  }

  /**
   * 获取宏定义
   */
  getMacro(name: string): MacroDefinition | undefined {
    return this.processor.getMacro(name);
  }

  /**
   * 获取所有宏名称
   */
  getMacroNames(): string[] {
    return this.processor.getMacroNames();
  }

  /**
   * 获取自定义宏名称
   */
  getCustomMacroNames(): string[] {
    return Array.from(this.customMacros);
  }

  /**
   * 检查是否是内置宏
   */
  isBuiltinMacro(name: string): boolean {
    return !this.customMacros.has(name.toLowerCase()) && 
           this.processor.getMacro(name) !== undefined;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalMacros: number;
    customMacros: number;
    builtinMacros: number;
    macroNames: string[];
  } {
    const stats = this.processor.getStats();
    return {
      totalMacros: stats.totalMacros,
      customMacros: this.customMacros.size,
      builtinMacros: stats.totalMacros - this.customMacros.size,
      macroNames: stats.macroNames,
    };
  }
}

/** 全局宏管理器单例 */
let globalManager: MacroManager | null = null;

/**
 * 获取全局宏管理器实例
 */
export function getMacroManager(): MacroManager {
  if (!globalManager) {
    globalManager = new MacroManager();
  }
  return globalManager;
}

/**
 * 重置全局宏管理器（主要用于测试）
 */
export function resetMacroManager(): void {
  if (globalManager) {
    globalManager.unregisterAll();
  }
  globalManager = null;
}

// ============ 便捷函数 ============

/**
 * 处理宏
 */
export async function processMacros(text: string, context?: Partial<MacroContext>): Promise<string> {
  return getMacroManager().process(text, context);
}

/**
 * 注册自定义宏
 */
export function registerMacro(options: RegisterMacroOptions): () => void {
  return getMacroManager().register(options);
}

/**
 * 注册简单宏
 */
export function registerSimpleMacro(name: string, replacement: string | (() => string)): () => void {
  return getMacroManager().registerSimple(name, replacement);
}

/**
 * 检查是否包含宏
 */
export function hasMacros(text: string): boolean {
  return getMacroManager().hasMacros(text);
}
