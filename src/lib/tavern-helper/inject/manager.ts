/**
 * TavernHelper 注入管理器
 * 实现提示词注入、位置控制、过滤器
 */

import type { InjectionPrompt, InjectionPosition, InjectOptions, MessageRole } from '../core/types';
import { getEventBus } from '../core/event-bus';
import { getLogger } from '../core/logger';
import { getMacroManager } from '../macros/manager';

/** 注入添加事件 */
export interface InjectionAddedEvent {
  injection: InjectionPrompt;
}

/** 注入移除事件 */
export interface InjectionRemovedEvent {
  injectionId: string;
}

/** 注入选项（扩展） */
export interface ExtendedInjectOptions extends InjectOptions {
  /** 是否处理宏 */
  processMacros?: boolean;
  /** 是否启用 */
  enabled?: boolean;
}

/** 内部注入项 */
interface InternalInjection {
  injection: InjectionPrompt;
  options: ExtendedInjectOptions;
  createdAt: number;
}

/**
 * 注入管理器类
 */
export class InjectManager {
  private logger = getLogger().withSource('InjectManager');
  private injections: Map<string, InternalInjection> = new Map();
  private injectionCounter = 0;

  /**
   * 生成注入 ID
   */
  private generateId(): string {
    return `inject_${++this.injectionCounter}_${Date.now()}`;
  }

  /**
   * 添加注入
   */
  add(
    content: string,
    position: InjectionPosition,
    options?: ExtendedInjectOptions & {
      id?: string;
      depth?: number;
      role?: MessageRole;
      filter?: () => boolean | Promise<boolean>;
      shouldScan?: boolean;
    }
  ): string {
    const id = options?.id ?? this.generateId();

    const injection: InjectionPrompt = {
      id,
      content,
      position,
      depth: options?.depth,
      role: options?.role,
      filter: options?.filter,
      shouldScan: options?.shouldScan,
    };

    const internal: InternalInjection = {
      injection,
      options: {
        once: options?.once ?? false,
        processMacros: options?.processMacros ?? true,
        enabled: options?.enabled ?? true,
      },
      createdAt: Date.now(),
    };

    this.injections.set(id, internal);

    // 触发事件
    getEventBus().emitSync<InjectionAddedEvent>('injection:added', { injection });

    this.logger.debug(`Injection added: ${id}`, { position, contentLength: content.length });

    return id;
  }

  /**
   * 添加到开头
   */
  addBefore(content: string, options?: ExtendedInjectOptions): string {
    return this.add(content, 'before', options);
  }

  /**
   * 添加到末尾
   */
  addAfter(content: string, options?: ExtendedInjectOptions): string {
    return this.add(content, 'after', options);
  }

  /**
   * 按深度添加到聊天中
   */
  addInChat(content: string, depth: number, options?: ExtendedInjectOptions): string {
    return this.add(content, 'in_chat', { ...options, depth });
  }

  /**
   * 移除注入
   */
  remove(id: string): boolean {
    const internal = this.injections.get(id);
    if (!internal) return false;

    this.injections.delete(id);

    // 触发事件
    getEventBus().emitSync<InjectionRemovedEvent>('injection:removed', { injectionId: id });

    this.logger.debug(`Injection removed: ${id}`);

    return true;
  }

  /**
   * 移除所有注入
   */
  removeAll(): number {
    const count = this.injections.size;
    
    Array.from(this.injections.keys()).forEach((id) => {
      this.remove(id);
    });

    return count;
  }

  /**
   * 移除指定位置的所有注入
   */
  removeByPosition(position: InjectionPosition): number {
    let count = 0;
    
    Array.from(this.injections.entries()).forEach(([id, internal]) => {
      if (internal.injection.position === position) {
        this.remove(id);
        count++;
      }
    });

    return count;
  }

  /**
   * 获取注入
   */
  get(id: string): InjectionPrompt | undefined {
    return this.injections.get(id)?.injection;
  }

  /**
   * 检查注入是否存在
   */
  has(id: string): boolean {
    return this.injections.has(id);
  }

  /**
   * 启用注入
   */
  enable(id: string): boolean {
    const internal = this.injections.get(id);
    if (!internal) return false;
    internal.options.enabled = true;
    return true;
  }

  /**
   * 禁用注入
   */
  disable(id: string): boolean {
    const internal = this.injections.get(id);
    if (!internal) return false;
    internal.options.enabled = false;
    return true;
  }

  /**
   * 切换注入状态
   */
  toggle(id: string): boolean {
    const internal = this.injections.get(id);
    if (!internal) return false;
    internal.options.enabled = !internal.options.enabled;
    return internal.options.enabled;
  }

  /**
   * 更新注入内容
   */
  update(id: string, content: string): boolean {
    const internal = this.injections.get(id);
    if (!internal) return false;
    internal.injection.content = content;
    return true;
  }

  /**
   * 更新注入位置
   */
  updatePosition(id: string, position: InjectionPosition, depth?: number): boolean {
    const internal = this.injections.get(id);
    if (!internal) return false;
    internal.injection.position = position;
    if (depth !== undefined) {
      internal.injection.depth = depth;
    }
    return true;
  }

  /**
   * 获取所有活跃注入（已过滤和处理）
   */
  async getActiveInjections(): Promise<InjectionPrompt[]> {
    const result: InjectionPrompt[] = [];
    const toRemove: string[] = [];

    for (const [id, internal] of Array.from(this.injections.entries())) {
      // 检查是否启用
      if (!internal.options.enabled) continue;

      // 应用过滤器
      if (internal.injection.filter) {
        try {
          const shouldInclude = await internal.injection.filter();
          if (!shouldInclude) continue;
        } catch (e) {
          this.logger.warn(`Injection filter error: ${id}`, e);
          continue;
        }
      }

      // 处理宏
      let content = internal.injection.content;
      if (internal.options.processMacros) {
        try {
          content = await getMacroManager().process(content);
        } catch (e) {
          this.logger.warn(`Injection macro processing error: ${id}`, e);
        }
      }

      result.push({
        ...internal.injection,
        content,
      });

      // 标记一次性注入待移除
      if (internal.options.once) {
        toRemove.push(id);
      }
    }

    // 移除一次性注入
    for (const id of toRemove) {
      this.remove(id);
    }

    return result;
  }

  /**
   * 获取所有注入（原始，不过滤）
   */
  getAll(): InjectionPrompt[] {
    return Array.from(this.injections.values()).map((i) => i.injection);
  }

  /**
   * 按位置获取注入
   */
  getByPosition(position: InjectionPosition): InjectionPrompt[] {
    return Array.from(this.injections.values())
      .filter((i) => i.injection.position === position)
      .map((i) => i.injection);
  }

  /**
   * 获取注入数量
   */
  count(): number {
    return this.injections.size;
  }

  /**
   * 监听注入添加
   */
  onAdded(callback: (event: InjectionAddedEvent) => void): () => void {
    return getEventBus().on('injection:added', callback);
  }

  /**
   * 监听注入移除
   */
  onRemoved(callback: (event: InjectionRemovedEvent) => void): () => void {
    return getEventBus().on('injection:removed', callback);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    enabled: number;
    disabled: number;
    byPosition: Record<InjectionPosition, number>;
    onceCount: number;
  } {
    const byPosition: Record<InjectionPosition, number> = {
      before: 0,
      after: 0,
      in_chat: 0,
      none: 0,
    };
    
    let enabled = 0;
    let disabled = 0;
    let onceCount = 0;

    Array.from(this.injections.values()).forEach((internal) => {
      byPosition[internal.injection.position]++;
      if (internal.options.enabled) {
        enabled++;
      } else {
        disabled++;
      }
      if (internal.options.once) {
        onceCount++;
      }
    });

    return {
      total: this.injections.size,
      enabled,
      disabled,
      byPosition,
      onceCount,
    };
  }
}

/** 全局注入管理器单例 */
let globalManager: InjectManager | null = null;

/**
 * 获取全局注入管理器实例
 */
export function getInjectManager(): InjectManager {
  if (!globalManager) {
    globalManager = new InjectManager();
  }
  return globalManager;
}

/**
 * 重置全局注入管理器（主要用于测试）
 */
export function resetInjectManager(): void {
  if (globalManager) {
    globalManager.removeAll();
  }
  globalManager = null;
}

// ============ 便捷函数 ============

/**
 * 添加注入
 */
export function addInjection(
  content: string,
  position: InjectionPosition,
  options?: ExtendedInjectOptions
): string {
  return getInjectManager().add(content, position, options);
}

/**
 * 添加到开头
 */
export function injectBefore(content: string, options?: ExtendedInjectOptions): string {
  return getInjectManager().addBefore(content, options);
}

/**
 * 添加到末尾
 */
export function injectAfter(content: string, options?: ExtendedInjectOptions): string {
  return getInjectManager().addAfter(content, options);
}

/**
 * 按深度添加
 */
export function injectInChat(content: string, depth: number, options?: ExtendedInjectOptions): string {
  return getInjectManager().addInChat(content, depth, options);
}

/**
 * 移除注入
 */
export function removeInjection(id: string): boolean {
  return getInjectManager().remove(id);
}

/**
 * 获取活跃注入
 */
export async function getActiveInjections(): Promise<InjectionPrompt[]> {
  return getInjectManager().getActiveInjections();
}
