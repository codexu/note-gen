/**
 * TavernHelper 注入系统
 * 提供动态提示词注入
 */

export {
  InjectManager,
  getInjectManager,
  resetInjectManager,
  // 便捷函数
  addInjection,
  injectBefore,
  injectAfter,
  injectInChat,
  removeInjection,
  getActiveInjections,
  // 类型
  type InjectionAddedEvent,
  type InjectionRemovedEvent,
  type ExtendedInjectOptions,
} from './manager';
