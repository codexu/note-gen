/**
 * TavernHelper 变量管理器
 * 提供高层 API，支持优先级解析和便捷操作
 */

import type { VariableScope, VariableValue, VariableContext } from '../core/types';
import { getVariableStore, type VariableChangeEvent } from './store';
import { getEventBus } from '../core/event-bus';
import { getLogger } from '../core/logger';
import { VariableError, ErrorCode } from '../core/error-handler';

/** 变量作用域优先级（从高到低） */
const SCOPE_PRIORITY: VariableScope[] = [
  'script',
  'message',
  'chat',
  'character',
  'preset',
  'global',
];

/** 变量获取选项 */
export interface GetVariableOptions {
  /** 指定作用域（不指定则按优先级查找） */
  scope?: VariableScope;
  /** 默认值 */
  defaultValue?: VariableValue;
  /** 上下文 */
  context?: VariableContext;
}

/** 变量设置选项 */
export interface SetVariableOptions {
  /** 指定作用域（默认 chat） */
  scope?: VariableScope;
  /** 上下文 */
  context?: VariableContext;
}

/** 变量列表选项 */
export interface ListVariablesOptions {
  /** 指定作用域（不指定则返回所有） */
  scope?: VariableScope;
  /** 上下文 */
  context?: VariableContext;
  /** 键名过滤 */
  filter?: string | RegExp;
}

/** 变量信息 */
export interface VariableInfo {
  key: string;
  value: VariableValue;
  scope: VariableScope;
}

/**
 * 变量管理器类
 */
export class VariableManager {
  private currentContext: VariableContext = {};
  private logger = getLogger().withSource('VariableManager');

  /**
   * 设置当前上下文
   */
  setContext(context: Partial<VariableContext>): void {
    this.currentContext = { ...this.currentContext, ...context };
    this.logger.debug('Context updated', this.currentContext);
  }

  /**
   * 获取当前上下文
   */
  getContext(): VariableContext {
    return { ...this.currentContext };
  }

  /**
   * 清除当前上下文
   */
  clearContext(): void {
    this.currentContext = {};
  }

  /**
   * 合并上下文
   */
  private mergeContext(options?: { context?: VariableContext }): VariableContext {
    return { ...this.currentContext, ...options?.context };
  }

  /**
   * 获取变量（支持优先级解析）
   */
  get(key: string, options?: GetVariableOptions): VariableValue | undefined {
    const store = getVariableStore();
    const context = this.mergeContext(options);

    // 如果指定了作用域，直接获取
    if (options?.scope) {
      const value = store.get(options.scope, key, context);
      return value !== undefined ? value : options?.defaultValue;
    }

    // 按优先级查找
    for (const scope of SCOPE_PRIORITY) {
      const value = store.get(scope, key, context);
      if (value !== undefined) {
        return value;
      }
    }

    return options?.defaultValue;
  }

  /**
   * 设置变量
   */
  set(key: string, value: VariableValue, options?: SetVariableOptions): void {
    const store = getVariableStore();
    const scope = options?.scope ?? 'chat';
    const context = this.mergeContext(options);

    store.set(scope, key, value, context);
    this.logger.debug(`Variable set: ${key}`, { scope, value });
  }

  /**
   * 删除变量
   */
  delete(key: string, options?: SetVariableOptions): boolean {
    const store = getVariableStore();
    const scope = options?.scope ?? 'chat';
    const context = this.mergeContext(options);

    const result = store.delete(scope, key, context);
    if (result) {
      this.logger.debug(`Variable deleted: ${key}`, { scope });
    }
    return result;
  }

  /**
   * 检查变量是否存在
   */
  has(key: string, options?: GetVariableOptions): boolean {
    const store = getVariableStore();
    const context = this.mergeContext(options);

    // 如果指定了作用域，直接检查
    if (options?.scope) {
      return store.has(options.scope, key, context);
    }

    // 按优先级查找
    for (const scope of SCOPE_PRIORITY) {
      if (store.has(scope, key, context)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取变量所在的作用域
   */
  findScope(key: string, context?: VariableContext): VariableScope | undefined {
    const store = getVariableStore();
    const ctx = this.mergeContext({ context });

    for (const scope of SCOPE_PRIORITY) {
      if (store.has(scope, key, ctx)) {
        return scope;
      }
    }

    return undefined;
  }

  /**
   * 列出变量
   */
  list(options?: ListVariablesOptions): VariableInfo[] {
    const store = getVariableStore();
    const context = this.mergeContext(options);
    const result: VariableInfo[] = [];

    const scopes = options?.scope ? [options.scope] : SCOPE_PRIORITY;

    for (const scope of scopes) {
      const vars = store.getAll(scope, context);
      
      for (const [key, value] of Object.entries(vars)) {
        // 应用过滤器
        if (options?.filter) {
          if (typeof options.filter === 'string') {
            if (!key.includes(options.filter)) continue;
          } else if (options.filter instanceof RegExp) {
            if (!options.filter.test(key)) continue;
          }
        }

        result.push({ key, value, scope });
      }
    }

    return result;
  }

  /**
   * 获取指定作用域的所有变量
   */
  getAll(scope: VariableScope, context?: VariableContext): Record<string, VariableValue> {
    const store = getVariableStore();
    return store.getAll(scope, this.mergeContext({ context }));
  }

  /**
   * 批量设置变量
   */
  setMany(
    vars: Record<string, VariableValue>,
    options?: SetVariableOptions
  ): void {
    for (const [key, value] of Object.entries(vars)) {
      this.set(key, value, options);
    }
  }

  /**
   * 批量删除变量
   */
  deleteMany(keys: string[], options?: SetVariableOptions): number {
    let count = 0;
    for (const key of keys) {
      if (this.delete(key, options)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 清空指定作用域的所有变量
   */
  clear(scope: VariableScope, context?: VariableContext): void {
    const store = getVariableStore();
    store.clear(scope, this.mergeContext({ context }));
    this.logger.debug(`Scope cleared: ${scope}`);
  }

  /**
   * 增加数值变量
   */
  increment(key: string, amount = 1, options?: SetVariableOptions): number {
    const current = this.get(key, { ...options, defaultValue: 0 });
    
    if (typeof current !== 'number') {
      throw new VariableError(
        ErrorCode.VARIABLE_TYPE_ERROR,
        `Cannot increment non-number variable: ${key}`,
        { data: { key, currentType: typeof current } }
      );
    }

    const newValue = current + amount;
    this.set(key, newValue, options);
    return newValue;
  }

  /**
   * 减少数值变量
   */
  decrement(key: string, amount = 1, options?: SetVariableOptions): number {
    return this.increment(key, -amount, options);
  }

  /**
   * 追加到数组变量
   */
  push(key: string, value: VariableValue, options?: SetVariableOptions): number {
    const current = this.get(key, { ...options, defaultValue: [] });
    
    if (!Array.isArray(current)) {
      throw new VariableError(
        ErrorCode.VARIABLE_TYPE_ERROR,
        `Cannot push to non-array variable: ${key}`,
        { data: { key, currentType: typeof current } }
      );
    }

    const newArray = [...current, value];
    this.set(key, newArray, options);
    return newArray.length;
  }

  /**
   * 从数组变量弹出
   */
  pop(key: string, options?: SetVariableOptions): VariableValue | undefined {
    const current = this.get(key, options);
    
    if (!Array.isArray(current) || current.length === 0) {
      return undefined;
    }

    const newArray = [...current];
    const popped = newArray.pop();
    this.set(key, newArray, options);
    return popped;
  }

  /**
   * 切换布尔变量
   */
  toggle(key: string, options?: SetVariableOptions): boolean {
    const current = this.get(key, { ...options, defaultValue: false });
    const newValue = !current;
    this.set(key, newValue, options);
    return newValue;
  }

  /**
   * 监听变量变更
   */
  onChange(
    callback: (event: VariableChangeEvent) => void,
    filter?: { key?: string | RegExp; scope?: VariableScope }
  ): () => void {
    const eventBus = getEventBus();
    
    return eventBus.on<VariableChangeEvent>('variable:changed', (event) => {
      // 应用过滤器
      if (filter?.scope && event.scope !== filter.scope) return;
      
      if (filter?.key) {
        if (typeof filter.key === 'string') {
          if (event.key !== filter.key) return;
        } else if (filter.key instanceof RegExp) {
          if (!filter.key.test(event.key)) return;
        }
      }

      callback(event);
    });
  }

  /**
   * 导出变量
   */
  export(options?: { scope?: VariableScope; context?: VariableContext }): string {
    const vars = this.list(options);
    return JSON.stringify(vars, null, 2);
  }

  /**
   * 导入变量
   */
  import(
    data: string | VariableInfo[],
    options?: { merge?: boolean; scope?: VariableScope }
  ): number {
    let vars: VariableInfo[];
    
    if (typeof data === 'string') {
      try {
        vars = JSON.parse(data);
      } catch (e) {
        throw new VariableError(
          ErrorCode.VARIABLE_TYPE_ERROR,
          'Invalid JSON data for import',
          { cause: e as Error }
        );
      }
    } else {
      vars = data;
    }

    if (!options?.merge && options?.scope) {
      this.clear(options.scope);
    }

    let count = 0;
    for (const { key, value, scope } of vars) {
      const targetScope = options?.scope ?? scope;
      this.set(key, value, { scope: targetScope });
      count++;
    }

    this.logger.info(`Imported ${count} variables`);
    return count;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalVariables: number;
    byScope: Record<string, number>;
  } {
    const store = getVariableStore();
    const stats = store.getStats();
    return {
      totalVariables: stats.totalVariables,
      byScope: stats.byScope,
    };
  }
}

/** 全局变量管理器单例 */
let globalManager: VariableManager | null = null;

/**
 * 获取全局变量管理器实例
 */
export function getVariableManager(): VariableManager {
  if (!globalManager) {
    globalManager = new VariableManager();
  }
  return globalManager;
}

/**
 * 重置全局变量管理器（主要用于测试）
 */
export function resetVariableManager(): void {
  if (globalManager) {
    globalManager.clearContext();
  }
  globalManager = null;
}

// ============ 便捷函数 ============

/**
 * 获取变量（快捷方式）
 */
export function getVar(key: string, defaultValue?: VariableValue): VariableValue | undefined {
  return getVariableManager().get(key, { defaultValue });
}

/**
 * 设置变量（快捷方式）
 */
export function setVar(key: string, value: VariableValue, scope?: VariableScope): void {
  getVariableManager().set(key, value, { scope });
}

/**
 * 删除变量（快捷方式）
 */
export function deleteVar(key: string, scope?: VariableScope): boolean {
  return getVariableManager().delete(key, { scope });
}

/**
 * 获取全局变量（快捷方式）
 */
export function getGlobalVar(key: string, defaultValue?: VariableValue): VariableValue | undefined {
  return getVariableManager().get(key, { scope: 'global', defaultValue });
}

/**
 * 设置全局变量（快捷方式）
 */
export function setGlobalVar(key: string, value: VariableValue): void {
  getVariableManager().set(key, value, { scope: 'global' });
}

/**
 * 获取聊天变量（快捷方式）
 */
export function getChatVar(key: string, defaultValue?: VariableValue): VariableValue | undefined {
  return getVariableManager().get(key, { scope: 'chat', defaultValue });
}

/**
 * 设置聊天变量（快捷方式）
 */
export function setChatVar(key: string, value: VariableValue): void {
  getVariableManager().set(key, value, { scope: 'chat' });
}
