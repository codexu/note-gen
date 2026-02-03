/**
 * TavernHelper 事件总线系统
 * 提供发布/订阅模式的事件处理，支持优先级和作用域隔离
 */

import type { EventListener, EventPriority } from './types';

/** 内部事件监听器包装 */
interface InternalListener<T = unknown> {
  id: string;
  callback: (data: T) => void | Promise<void>;
  priority: EventPriority;
  once: boolean;
  scope?: string;
  createdAt: number;
}

/** 事件总线配置 */
export interface EventBusConfig {
  /** 是否启用调试日志 */
  debug?: boolean;
  /** 最大监听器数量（每个事件） */
  maxListeners?: number;
  /** 默认作用域 */
  defaultScope?: string;
}

/** 事件总线类 */
export class EventBus {
  private listeners: Map<string, InternalListener[]> = new Map();
  private config: Required<EventBusConfig>;
  private listenerIdCounter = 0;
  private eventHistory: Array<{ event: string; data: unknown; timestamp: number }> = [];
  private maxHistorySize = 100;

  constructor(config: EventBusConfig = {}) {
    this.config = {
      debug: config.debug ?? false,
      maxListeners: config.maxListeners ?? 100,
      defaultScope: config.defaultScope ?? 'global',
    };
  }

  /**
   * 生成唯一的监听器 ID
   */
  private generateListenerId(): string {
    return `listener_${++this.listenerIdCounter}_${Date.now()}`;
  }

  /**
   * 获取事件的监听器列表
   */
  private getListeners(event: string): InternalListener[] {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    return this.listeners.get(event)!;
  }

  /**
   * 按优先级排序监听器
   */
  private sortListeners(listeners: InternalListener[]): void {
    const priorityOrder: Record<EventPriority, number> = {
      first: 0,
      high: 1,
      normal: 2,
      low: 3,
      last: 4,
    };
    
    listeners.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      // 同优先级按创建时间排序
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * 添加事件监听器
   */
  private addListener<T>(
    event: string,
    callback: (data: T) => void | Promise<void>,
    options: {
      priority?: EventPriority;
      once?: boolean;
      scope?: string;
    } = {}
  ): () => void {
    const listeners = this.getListeners(event);
    
    if (listeners.length >= this.config.maxListeners) {
      console.warn(
        `[TavernHelper EventBus] 事件 "${event}" 的监听器数量已达上限 (${this.config.maxListeners})`
      );
    }

    const listener: InternalListener<T> = {
      id: this.generateListenerId(),
      callback: callback as (data: unknown) => void | Promise<void>,
      priority: options.priority ?? 'normal',
      once: options.once ?? false,
      scope: options.scope ?? this.config.defaultScope,
      createdAt: Date.now(),
    };

    listeners.push(listener as InternalListener);
    this.sortListeners(listeners);

    if (this.config.debug) {
      console.log(
        `[TavernHelper EventBus] 添加监听器: ${event} (${listener.id}, priority: ${listener.priority})`
      );
    }

    // 返回取消订阅函数
    return () => this.removeListenerById(event, listener.id);
  }

  /**
   * 注册事件监听器
   */
  on<T = unknown>(
    event: string,
    callback: (data: T) => void | Promise<void>,
    scope?: string
  ): () => void {
    return this.addListener(event, callback, { scope });
  }

  /**
   * 注册一次性事件监听器
   */
  once<T = unknown>(
    event: string,
    callback: (data: T) => void | Promise<void>,
    scope?: string
  ): () => void {
    return this.addListener(event, callback, { once: true, scope });
  }

  /**
   * 注册最高优先级监听器（最先执行）
   */
  makeFirst<T = unknown>(
    event: string,
    callback: (data: T) => void | Promise<void>,
    scope?: string
  ): () => void {
    return this.addListener(event, callback, { priority: 'first', scope });
  }

  /**
   * 注册最低优先级监听器（最后执行）
   */
  makeLast<T = unknown>(
    event: string,
    callback: (data: T) => void | Promise<void>,
    scope?: string
  ): () => void {
    return this.addListener(event, callback, { priority: 'last', scope });
  }

  /**
   * 注册高优先级监听器
   */
  high<T = unknown>(
    event: string,
    callback: (data: T) => void | Promise<void>,
    scope?: string
  ): () => void {
    return this.addListener(event, callback, { priority: 'high', scope });
  }

  /**
   * 注册低优先级监听器
   */
  low<T = unknown>(
    event: string,
    callback: (data: T) => void | Promise<void>,
    scope?: string
  ): () => void {
    return this.addListener(event, callback, { priority: 'low', scope });
  }

  /**
   * 异步触发事件（按优先级顺序执行所有监听器）
   */
  async emit<T = unknown>(event: string, data?: T): Promise<void> {
    const listeners = this.getListeners(event);
    
    if (this.config.debug) {
      console.log(
        `[TavernHelper EventBus] 触发事件: ${event} (${listeners.length} 个监听器)`
      );
    }

    // 记录事件历史
    this.recordEvent(event, data);

    // 收集需要移除的一次性监听器
    const toRemove: string[] = [];

    for (const listener of listeners) {
      try {
        await listener.callback(data);
        
        if (listener.once) {
          toRemove.push(listener.id);
        }
      } catch (error) {
        console.error(
          `[TavernHelper EventBus] 监听器执行错误 (${event}, ${listener.id}):`,
          error
        );
      }
    }

    // 移除一次性监听器
    for (const id of toRemove) {
      this.removeListenerById(event, id);
    }
  }

  /**
   * 同步触发事件（不等待异步监听器完成）
   */
  emitSync<T = unknown>(event: string, data?: T): void {
    const listeners = this.getListeners(event);
    
    if (this.config.debug) {
      console.log(
        `[TavernHelper EventBus] 同步触发事件: ${event} (${listeners.length} 个监听器)`
      );
    }

    // 记录事件历史
    this.recordEvent(event, data);

    // 收集需要移除的一次性监听器
    const toRemove: string[] = [];

    for (const listener of listeners) {
      try {
        const result = listener.callback(data);
        
        // 如果返回 Promise，不等待但记录错误
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(
              `[TavernHelper EventBus] 异步监听器执行错误 (${event}, ${listener.id}):`,
              error
            );
          });
        }
        
        if (listener.once) {
          toRemove.push(listener.id);
        }
      } catch (error) {
        console.error(
          `[TavernHelper EventBus] 监听器执行错误 (${event}, ${listener.id}):`,
          error
        );
      }
    }

    // 移除一次性监听器
    for (const id of toRemove) {
      this.removeListenerById(event, id);
    }
  }

  /**
   * 通过 ID 移除监听器
   */
  private removeListenerById(event: string, listenerId: string): boolean {
    const listeners = this.listeners.get(event);
    if (!listeners) return false;

    const index = listeners.findIndex((l) => l.id === listenerId);
    if (index === -1) return false;

    listeners.splice(index, 1);
    
    if (this.config.debug) {
      console.log(
        `[TavernHelper EventBus] 移除监听器: ${event} (${listenerId})`
      );
    }
    
    return true;
  }

  /**
   * 通过回调函数移除监听器
   */
  removeListener<T = unknown>(event: string, callback: EventListener<T>): boolean {
    const listeners = this.listeners.get(event);
    if (!listeners) return false;

    const index = listeners.findIndex((l) => l.callback === callback);
    if (index === -1) return false;

    const removed = listeners.splice(index, 1)[0];
    
    if (this.config.debug) {
      console.log(
        `[TavernHelper EventBus] 移除监听器: ${event} (${removed.id})`
      );
    }
    
    return true;
  }

  /**
   * 移除指定事件的所有监听器，或移除所有事件的监听器
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      if (this.config.debug) {
        console.log(`[TavernHelper EventBus] 移除事件所有监听器: ${event}`);
      }
    } else {
      this.listeners.clear();
      if (this.config.debug) {
        console.log('[TavernHelper EventBus] 移除所有监听器');
      }
    }
  }

  /**
   * 移除指定作用域的所有监听器
   */
  removeListenersByScope(scope: string): void {
    Array.from(this.listeners.entries()).forEach(([event, listeners]) => {
      const filtered = listeners.filter((l) => l.scope !== scope);
      if (filtered.length !== listeners.length) {
        this.listeners.set(event, filtered);
        if (this.config.debug) {
          console.log(
            `[TavernHelper EventBus] 移除作用域监听器: ${event} (scope: ${scope}, 移除 ${listeners.length - filtered.length} 个)`
          );
        }
      }
    });
  }

  /**
   * 获取事件的监听器数量
   */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  /**
   * 获取所有已注册的事件名称
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys()).filter(
      (event) => this.listeners.get(event)!.length > 0
    );
  }

  /**
   * 检查事件是否有监听器
   */
  hasListeners(event: string): boolean {
    return this.listenerCount(event) > 0;
  }

  /**
   * 记录事件到历史
   */
  private recordEvent(event: string, data: unknown): void {
    this.eventHistory.push({
      event,
      data,
      timestamp: Date.now(),
    });

    // 限制历史记录大小
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * 获取事件历史
   */
  getEventHistory(event?: string): Array<{ event: string; data: unknown; timestamp: number }> {
    if (event) {
      return this.eventHistory.filter((e) => e.event === event);
    }
    return [...this.eventHistory];
  }

  /**
   * 清空事件历史
   */
  clearEventHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 等待事件触发（返回 Promise）
   */
  waitFor<T = unknown>(event: string, timeout?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const unsubscribe = this.once<T>(event, (data) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(data);
      });

      if (timeout) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`等待事件 "${event}" 超时 (${timeout}ms)`));
        }, timeout);
      }
    });
  }

  /**
   * 创建带作用域的事件总线代理
   */
  withScope(scope: string): ScopedEventBus {
    return new ScopedEventBus(this, scope);
  }

  /**
   * 启用/禁用调试模式
   */
  setDebug(enabled: boolean): void {
    this.config.debug = enabled;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalEvents: number;
    totalListeners: number;
    eventCounts: Record<string, number>;
  } {
    const eventCounts: Record<string, number> = {};
    let totalListeners = 0;

    Array.from(this.listeners.entries()).forEach(([event, listeners]) => {
      eventCounts[event] = listeners.length;
      totalListeners += listeners.length;
    });

    return {
      totalEvents: this.listeners.size,
      totalListeners,
      eventCounts,
    };
  }
}

/**
 * 带作用域的事件总线代理
 * 所有监听器自动绑定到指定作用域，便于批量清理
 */
export class ScopedEventBus {
  constructor(
    private bus: EventBus,
    private scope: string
  ) {}

  on<T = unknown>(event: string, callback: (data: T) => void | Promise<void>): () => void {
    return this.bus.on(event, callback, this.scope);
  }

  once<T = unknown>(event: string, callback: (data: T) => void | Promise<void>): () => void {
    return this.bus.once(event, callback, this.scope);
  }

  makeFirst<T = unknown>(event: string, callback: (data: T) => void | Promise<void>): () => void {
    return this.bus.makeFirst(event, callback, this.scope);
  }

  makeLast<T = unknown>(event: string, callback: (data: T) => void | Promise<void>): () => void {
    return this.bus.makeLast(event, callback, this.scope);
  }

  emit<T = unknown>(event: string, data?: T): Promise<void> {
    return this.bus.emit(event, data);
  }

  emitSync<T = unknown>(event: string, data?: T): void {
    this.bus.emitSync(event, data);
  }

  waitFor<T = unknown>(event: string, timeout?: number): Promise<T> {
    return this.bus.waitFor(event, timeout);
  }

  /**
   * 移除此作用域的所有监听器
   */
  dispose(): void {
    this.bus.removeListenersByScope(this.scope);
  }
}

/** 全局事件总线单例 */
let globalEventBus: EventBus | null = null;

/**
 * 获取全局事件总线实例
 */
export function getEventBus(): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus();
  }
  return globalEventBus;
}

/**
 * 初始化全局事件总线（可配置）
 */
export function initEventBus(config?: EventBusConfig): EventBus {
  globalEventBus = new EventBus(config);
  return globalEventBus;
}

/**
 * 重置全局事件总线（主要用于测试）
 */
export function resetEventBus(): void {
  if (globalEventBus) {
    globalEventBus.removeAllListeners();
  }
  globalEventBus = null;
}
