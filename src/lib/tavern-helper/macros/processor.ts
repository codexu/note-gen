/**
 * TavernHelper 宏处理器
 * 实现宏解析、执行和内置宏
 */

import type { MacroContext, MacroHandler, MacroDefinition, VariableValue } from '../core/types';
import { getVariableManager } from '../variables/manager';
import { getLogger } from '../core/logger';
import { MacroError, ErrorCode } from '../core/error-handler';

/** 内置宏名称 */
export type BuiltinMacroName =
  | 'getvar'
  | 'setvar'
  | 'addvar'
  | 'incvar'
  | 'decvar'
  | 'getglobalvar'
  | 'setglobalvar'
  | 'random'
  | 'roll'
  | 'pick'
  | 'if'
  | 'time'
  | 'date'
  | 'datetime'
  | 'idle_duration'
  | 'char'
  | 'user'
  | 'input'
  | 'trim'
  | 'lower'
  | 'upper'
  | 'replace'
  | 'split'
  | 'join'
  | 'length'
  | 'substr'
  | 'index'
  | 'lastindex';

/**
 * 宏处理器类
 */
export class MacroProcessor {
  private logger = getLogger().withSource('MacroProcessor');
  private macros: Map<string, MacroDefinition> = new Map();
  private processingStack: Set<string> = new Set(); // 防止循环引用

  constructor() {
    this.registerBuiltinMacros();
  }

  /**
   * 注册内置宏
   */
  private registerBuiltinMacros(): void {
    // 变量操作宏
    this.register({
      name: 'getvar',
      pattern: /\{\{getvar::([^}]+)\}\}/gi,
      handler: (ctx, match, key) => {
        const value = getVariableManager().get(key.trim());
        return this.valueToString(value);
      },
      description: '获取变量值',
    });

    this.register({
      name: 'setvar',
      pattern: /\{\{setvar::([^:}]+)::([^}]*)\}\}/gi,
      handler: (ctx, match, key, value) => {
        getVariableManager().set(key.trim(), this.parseValue(value));
        return '';
      },
      description: '设置变量值',
    });

    this.register({
      name: 'addvar',
      pattern: /\{\{addvar::([^:}]+)::([^}]*)\}\}/gi,
      handler: (ctx, match, key, value) => {
        const current = getVariableManager().get(key.trim(), { defaultValue: 0 });
        if (typeof current === 'number') {
          getVariableManager().set(key.trim(), current + Number(value));
        }
        return '';
      },
      description: '增加变量值',
    });

    this.register({
      name: 'incvar',
      pattern: /\{\{incvar::([^}]+)\}\}/gi,
      handler: (ctx, match, key) => {
        const newVal = getVariableManager().increment(key.trim());
        return String(newVal);
      },
      description: '变量加1',
    });

    this.register({
      name: 'decvar',
      pattern: /\{\{decvar::([^}]+)\}\}/gi,
      handler: (ctx, match, key) => {
        const newVal = getVariableManager().decrement(key.trim());
        return String(newVal);
      },
      description: '变量减1',
    });

    this.register({
      name: 'getglobalvar',
      pattern: /\{\{getglobalvar::([^}]+)\}\}/gi,
      handler: (ctx, match, key) => {
        const value = getVariableManager().get(key.trim(), { scope: 'global' });
        return this.valueToString(value);
      },
      description: '获取全局变量',
    });

    this.register({
      name: 'setglobalvar',
      pattern: /\{\{setglobalvar::([^:}]+)::([^}]*)\}\}/gi,
      handler: (ctx, match, key, value) => {
        getVariableManager().set(key.trim(), this.parseValue(value), { scope: 'global' });
        return '';
      },
      description: '设置全局变量',
    });

    // 随机数宏
    this.register({
      name: 'random',
      pattern: /\{\{random(?:::(\d+)(?:::(\d+))?)?\}\}/gi,
      handler: (ctx, match, min, max) => {
        const minVal = min ? parseInt(min, 10) : 0;
        const maxVal = max ? parseInt(max, 10) : 100;
        return String(Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal);
      },
      description: '生成随机数',
    });

    this.register({
      name: 'roll',
      pattern: /\{\{roll::(\d+)d(\d+)\}\}/gi,
      handler: (ctx, match, count, sides) => {
        const numDice = parseInt(count, 10);
        const numSides = parseInt(sides, 10);
        let total = 0;
        for (let i = 0; i < numDice; i++) {
          total += Math.floor(Math.random() * numSides) + 1;
        }
        return String(total);
      },
      description: '掷骰子',
    });

    this.register({
      name: 'pick',
      pattern: /\{\{pick::([^}]+)\}\}/gi,
      handler: (ctx, match, options) => {
        const items = options.split('::').map((s) => s.trim());
        return items[Math.floor(Math.random() * items.length)] || '';
      },
      description: '随机选择',
    });

    // 条件宏
    this.register({
      name: 'if',
      pattern: /\{\{if::([^:}]+)::([^:}]*)(?:::([^}]*))?\}\}/gi,
      handler: (ctx, match, condition, trueVal, falseVal) => {
        const result = this.evaluateCondition(condition, ctx);
        return result ? trueVal : (falseVal || '');
      },
      description: '条件判断',
    });

    // 时间日期宏
    this.register({
      name: 'time',
      pattern: /\{\{time\}\}/gi,
      handler: () => new Date().toLocaleTimeString(),
      description: '当前时间',
    });

    this.register({
      name: 'date',
      pattern: /\{\{date\}\}/gi,
      handler: () => new Date().toLocaleDateString(),
      description: '当前日期',
    });

    this.register({
      name: 'datetime',
      pattern: /\{\{datetime\}\}/gi,
      handler: () => new Date().toLocaleString(),
      description: '当前日期时间',
    });

    // 字符串操作宏
    this.register({
      name: 'trim',
      pattern: /\{\{trim::([^}]*)\}\}/gi,
      handler: (ctx, match, text) => text.trim(),
      description: '去除首尾空白',
    });

    this.register({
      name: 'lower',
      pattern: /\{\{lower::([^}]*)\}\}/gi,
      handler: (ctx, match, text) => text.toLowerCase(),
      description: '转小写',
    });

    this.register({
      name: 'upper',
      pattern: /\{\{upper::([^}]*)\}\}/gi,
      handler: (ctx, match, text) => text.toUpperCase(),
      description: '转大写',
    });

    this.register({
      name: 'replace',
      pattern: /\{\{replace::([^:}]*)::([^:}]*)::([^}]*)\}\}/gi,
      handler: (ctx, match, text, search, replacement) => {
        return text.split(search).join(replacement);
      },
      description: '替换文本',
    });

    this.register({
      name: 'length',
      pattern: /\{\{length::([^}]*)\}\}/gi,
      handler: (ctx, match, text) => String(text.length),
      description: '获取长度',
    });

    this.register({
      name: 'substr',
      pattern: /\{\{substr::([^:}]*)::(\d+)(?:::(\d+))?\}\}/gi,
      handler: (ctx, match, text, start, length) => {
        const startIdx = parseInt(start, 10);
        if (length) {
          return text.substr(startIdx, parseInt(length, 10));
        }
        return text.substr(startIdx);
      },
      description: '截取子串',
    });

    // 数学宏
    this.register({
      name: 'calc',
      pattern: /\{\{calc::([^}]+)\}\}/gi,
      handler: (ctx, match, expr) => {
        try {
          // 简单的数学表达式求值（只支持基本运算）
          const sanitized = expr.replace(/[^0-9+\-*/().%\s]/g, '');
          // eslint-disable-next-line no-eval
          const result = Function(`"use strict"; return (${sanitized})`)();
          return String(result);
        } catch {
          return 'NaN';
        }
      },
      description: '数学计算',
    });
  }

  /**
   * 注册宏
   */
  register(macro: MacroDefinition): void {
    this.macros.set(macro.name.toLowerCase(), macro);
    this.logger.debug(`Macro registered: ${macro.name}`);
  }

  /**
   * 注销宏
   */
  unregister(name: string): boolean {
    const result = this.macros.delete(name.toLowerCase());
    if (result) {
      this.logger.debug(`Macro unregistered: ${name}`);
    }
    return result;
  }

  /**
   * 获取宏定义
   */
  getMacro(name: string): MacroDefinition | undefined {
    return this.macros.get(name.toLowerCase());
  }

  /**
   * 获取所有宏名称
   */
  getMacroNames(): string[] {
    return Array.from(this.macros.keys());
  }

  /**
   * 处理文本中的所有宏
   */
  async process(text: string, context?: Partial<MacroContext>): Promise<string> {
    const ctx: MacroContext = {
      messageId: context?.messageId,
      role: context?.role,
      chatId: context?.chatId,
      characterId: context?.characterId,
      variables: context?.variables ?? {},
    };

    let result = text;
    let iterations = 0;
    const maxIterations = 10; // 防止无限循环

    // 多轮处理以支持嵌套宏
    while (iterations < maxIterations) {
      const previousResult = result;
      result = await this.processOnce(result, ctx);
      
      if (result === previousResult) {
        break; // 没有更多宏需要处理
      }
      iterations++;
    }

    if (iterations >= maxIterations) {
      this.logger.warn('Macro processing reached max iterations');
    }

    return result;
  }

  /**
   * 单轮处理宏
   */
  private async processOnce(text: string, context: MacroContext): Promise<string> {
    let result = text;

    // 按优先级排序宏
    const sortedMacros = Array.from(this.macros.values()).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );

    for (const macro of sortedMacros) {
      result = await this.processMacro(result, macro, context);
    }

    return result;
  }

  /**
   * 处理单个宏
   */
  private async processMacro(
    text: string,
    macro: MacroDefinition,
    context: MacroContext
  ): Promise<string> {
    // 重置 regex lastIndex
    macro.pattern.lastIndex = 0;

    const matches: Array<{ match: RegExpExecArray; index: number }> = [];
    let match: RegExpExecArray | null;

    while ((match = macro.pattern.exec(text)) !== null) {
      matches.push({ match, index: match.index });
    }

    if (matches.length === 0) {
      return text;
    }

    // 从后往前替换，避免索引偏移问题
    let result = text;
    for (let i = matches.length - 1; i >= 0; i--) {
      const { match } = matches[i];
      const fullMatch = match[0];
      const args = match.slice(1);

      // 检查循环引用
      const macroKey = `${macro.name}:${args.join(':')}`;
      if (this.processingStack.has(macroKey)) {
        throw new MacroError(
          ErrorCode.MACRO_CIRCULAR_REFERENCE,
          `Circular reference detected in macro: ${macro.name}`,
          { data: { macro: macro.name, args } }
        );
      }

      try {
        this.processingStack.add(macroKey);
        const replacement = await macro.handler(context, fullMatch, ...args);
        result = result.slice(0, match.index) + replacement + result.slice(match.index + fullMatch.length);
      } catch (error) {
        if (error instanceof MacroError) {
          throw error;
        }
        throw new MacroError(
          ErrorCode.MACRO_EXECUTION_ERROR,
          `Error executing macro ${macro.name}: ${(error as Error).message}`,
          { cause: error as Error, data: { macro: macro.name, args } }
        );
      } finally {
        this.processingStack.delete(macroKey);
      }
    }

    return result;
  }

  /**
   * 值转字符串
   */
  private valueToString(value: VariableValue | undefined): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * 解析值
   */
  private parseValue(str: string): VariableValue {
    const trimmed = str.trim();
    
    // 尝试解析为数字
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
    
    // 尝试解析为布尔值
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
    
    // 尝试解析为 JSON
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // 解析失败，返回原字符串
      }
    }
    
    return trimmed;
  }

  /**
   * 评估条件
   */
  private evaluateCondition(condition: string, context: MacroContext): boolean {
    const trimmed = condition.trim();
    
    // 处理变量引用
    const resolved = trimmed.replace(/\$(\w+)/g, (_, name) => {
      const value = context.variables[name] ?? getVariableManager().get(name);
      return this.valueToString(value);
    });

    // 简单比较操作
    const comparisons = [
      { op: '===', fn: (a: string, b: string) => a === b },
      { op: '!==', fn: (a: string, b: string) => a !== b },
      { op: '==', fn: (a: string, b: string) => a == b },
      { op: '!=', fn: (a: string, b: string) => a != b },
      { op: '>=', fn: (a: string, b: string) => Number(a) >= Number(b) },
      { op: '<=', fn: (a: string, b: string) => Number(a) <= Number(b) },
      { op: '>', fn: (a: string, b: string) => Number(a) > Number(b) },
      { op: '<', fn: (a: string, b: string) => Number(a) < Number(b) },
    ];

    for (const { op, fn } of comparisons) {
      if (resolved.includes(op)) {
        const [left, right] = resolved.split(op).map((s) => s.trim());
        return fn(left, right);
      }
    }

    // 真值判断
    return Boolean(resolved) && resolved !== '0' && resolved.toLowerCase() !== 'false';
  }

  /**
   * 检查文本是否包含宏
   */
  hasMacros(text: string): boolean {
    return /\{\{[^}]+\}\}/.test(text);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalMacros: number;
    macroNames: string[];
  } {
    return {
      totalMacros: this.macros.size,
      macroNames: this.getMacroNames(),
    };
  }
}

/** 全局宏处理器单例 */
let globalProcessor: MacroProcessor | null = null;

/**
 * 获取全局宏处理器实例
 */
export function getMacroProcessor(): MacroProcessor {
  if (!globalProcessor) {
    globalProcessor = new MacroProcessor();
  }
  return globalProcessor;
}

/**
 * 重置全局宏处理器（主要用于测试）
 */
export function resetMacroProcessor(): void {
  globalProcessor = null;
}
