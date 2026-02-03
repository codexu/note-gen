/**
 * TavernHelper 变量存储模块
 * 实现各作用域的变量存储和持久化
 */

import type { VariableScope, VariableValue, VariableContext } from '../core/types';
import { getEventBus } from '../core/event-bus';
import { getLogger } from '../core/logger';

/** 存储键前缀 */
const STORAGE_PREFIX = 'tavern_helper_vars_';

/** 变量变更事件数据 */
export interface VariableChangeEvent {
  scope: VariableScope;
  key: string;
  oldValue: VariableValue | undefined;
  newValue: VariableValue | undefined;
  context?: VariableContext;
}

/**
 * 单作用域变量存储
 */
class ScopeStore {
  private cache: Map<string, VariableValue> = new Map();
  private dirty = false;

  constructor(
    readonly scope: VariableScope,
    private readonly persistent: boolean,
    private readonly contextKey?: string
  ) {
    if (persistent) {
      this.load();
    }
  }

  /**
   * 获取存储键
   */
  private getStorageKey(): string {
    const base = `${STORAGE_PREFIX}${this.scope}`;
    return this.contextKey ? `${base}_${this.contextKey}` : base;
  }

  /**
   * 从本地存储加载
   */
  private load(): void {
    if (typeof localStorage === 'undefined') return;
    
    try {
      const data = localStorage.getItem(this.getStorageKey());
      if (data) {
        const parsed = JSON.parse(data);
        if (typeof parsed === 'object' && parsed !== null) {
          Object.entries(parsed).forEach(([key, value]) => {
            this.cache.set(key, value as VariableValue);
          });
        }
      }
    } catch (e) {
      getLogger().warn(`Failed to load variables for scope ${this.scope}`, e);
    }
  }

  /**
   * 保存到本地存储
   */
  save(): void {
    if (!this.persistent || typeof localStorage === 'undefined') return;
    if (!this.dirty) return;

    try {
      const data: Record<string, VariableValue> = {};
      this.cache.forEach((value, key) => {
        data[key] = value;
      });
      localStorage.setItem(this.getStorageKey(), JSON.stringify(data));
      this.dirty = false;
    } catch (e) {
      getLogger().warn(`Failed to save variables for scope ${this.scope}`, e);
    }
  }

  /**
   * 获取变量
   */
  get(key: string): VariableValue | undefined {
    return this.cache.get(key);
  }

  /**
   * 设置变量
   */
  set(key: string, value: VariableValue): void {
    this.cache.set(key, value);
    this.dirty = true;
  }

  /**
   * 删除变量
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    if (result) {
      this.dirty = true;
    }
    return result;
  }

  /**
   * 检查变量是否存在
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 获取所有变量
   */
  getAll(): Record<string, VariableValue> {
    const result: Record<string, VariableValue> = {};
    this.cache.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * 获取所有键
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取变量数量
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 清空所有变量
   */
  clear(): void {
    this.cache.clear();
    this.dirty = true;
  }

  /**
   * 批量设置变量
   */
  setMany(vars: Record<string, VariableValue>): void {
    Object.entries(vars).forEach(([key, value]) => {
      this.cache.set(key, value);
    });
    this.dirty = true;
  }
}

/**
 * 变量存储管理器
 * 管理所有作用域的变量存储
 */
export class VariableStore {
  private stores: Map<string, ScopeStore> = new Map();
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 初始化全局作用域存储
    this.getOrCreateStore('global', true);
    
    // 启动自动保存
    this.startAutoSave();
  }

  /**
   * 获取或创建作用域存储
   */
  private getOrCreateStore(
    scope: VariableScope,
    persistent: boolean,
    contextKey?: string
  ): ScopeStore {
    const storeKey = contextKey ? `${scope}_${contextKey}` : scope;
    
    if (!this.stores.has(storeKey)) {
      this.stores.set(storeKey, new ScopeStore(scope, persistent, contextKey));
    }
    
    return this.stores.get(storeKey)!;
  }

  /**
   * 根据作用域和上下文获取存储
   */
  getStore(scope: VariableScope, context?: VariableContext): ScopeStore {
    switch (scope) {
      case 'global':
        return this.getOrCreateStore('global', true);
      
      case 'preset':
        const presetKey = context?.presetId?.toString();
        return this.getOrCreateStore('preset', true, presetKey);
      
      case 'character':
        const charKey = context?.characterId?.toString();
        return this.getOrCreateStore('character', true, charKey);
      
      case 'chat':
        const chatKey = context?.chatId?.toString();
        return this.getOrCreateStore('chat', true, chatKey);
      
      case 'message':
        const msgKey = context?.messageId?.toString();
        return this.getOrCreateStore('message', false, msgKey);
      
      case 'script':
        const scriptKey = context?.scriptId;
        return this.getOrCreateStore('script', false, scriptKey);
      
      default:
        return this.getOrCreateStore('global', true);
    }
  }

  /**
   * 获取变量
   */
  get(scope: VariableScope, key: string, context?: VariableContext): VariableValue | undefined {
    return this.getStore(scope, context).get(key);
  }

  /**
   * 设置变量
   */
  set(
    scope: VariableScope,
    key: string,
    value: VariableValue,
    context?: VariableContext
  ): void {
    const store = this.getStore(scope, context);
    const oldValue = store.get(key);
    store.set(key, value);

    // 触发变更事件
    const eventBus = getEventBus();
    eventBus.emitSync<VariableChangeEvent>('variable:changed', {
      scope,
      key,
      oldValue,
      newValue: value,
      context,
    });
  }

  /**
   * 删除变量
   */
  delete(scope: VariableScope, key: string, context?: VariableContext): boolean {
    const store = this.getStore(scope, context);
    const oldValue = store.get(key);
    const result = store.delete(key);

    if (result) {
      // 触发变更事件
      const eventBus = getEventBus();
      eventBus.emitSync<VariableChangeEvent>('variable:changed', {
        scope,
        key,
        oldValue,
        newValue: undefined,
        context,
      });
    }

    return result;
  }

  /**
   * 检查变量是否存在
   */
  has(scope: VariableScope, key: string, context?: VariableContext): boolean {
    return this.getStore(scope, context).has(key);
  }

  /**
   * 获取作用域内所有变量
   */
  getAll(scope: VariableScope, context?: VariableContext): Record<string, VariableValue> {
    return this.getStore(scope, context).getAll();
  }

  /**
   * 获取作用域内所有键
   */
  keys(scope: VariableScope, context?: VariableContext): string[] {
    return this.getStore(scope, context).keys();
  }

  /**
   * 清空作用域内所有变量
   */
  clear(scope: VariableScope, context?: VariableContext): void {
    this.getStore(scope, context).clear();
  }

  /**
   * 启动自动保存
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) return;
    
    // 每 5 秒自动保存
    this.autoSaveInterval = setInterval(() => {
      this.saveAll();
    }, 5000);
  }

  /**
   * 停止自动保存
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  /**
   * 保存所有存储
   */
  saveAll(): void {
    this.stores.forEach((store) => {
      store.save();
    });
  }

  /**
   * 清理指定上下文的存储
   */
  cleanupContext(scope: VariableScope, contextKey: string): void {
    const storeKey = `${scope}_${contextKey}`;
    const store = this.stores.get(storeKey);
    if (store) {
      store.clear();
      this.stores.delete(storeKey);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalStores: number;
    totalVariables: number;
    byScope: Record<string, number>;
  } {
    const byScope: Record<string, number> = {};
    let totalVariables = 0;

    this.stores.forEach((store, key) => {
      const count = store.size();
      byScope[key] = count;
      totalVariables += count;
    });

    return {
      totalStores: this.stores.size,
      totalVariables,
      byScope,
    };
  }
}

/** 全局变量存储单例 */
let globalStore: VariableStore | null = null;

/**
 * 获取全局变量存储实例
 */
export function getVariableStore(): VariableStore {
  if (!globalStore) {
    globalStore = new VariableStore();
  }
  return globalStore;
}

/**
 * 重置全局变量存储（主要用于测试）
 */
export function resetVariableStore(): void {
  if (globalStore) {
    globalStore.stopAutoSave();
    globalStore.saveAll();
  }
  globalStore = null;
}
