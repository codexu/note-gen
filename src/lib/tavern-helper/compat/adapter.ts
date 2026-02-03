/**
 * TavernHelper 兼容层适配器
 * 提供与 SillyTavern JS-Slash-Runner 兼容的 API
 */

import type {
  VariableScope,
  VariableValue,
  ChatMessage,
  MessageRole,
  AIMessage,
  GenerateConfig,
  InjectionPosition,
  MacroContext,
  EventListener,
} from '../core/types';
import { getVariableManager } from '../variables/manager';
import { getMessageManager } from '../messages/manager';
import { getGenerateManager, type GenerateResult } from '../generate';
import { getMacroManager } from '../macros/manager';
import { getInjectManager } from '../inject/manager';
import { getEventBus } from '../core/event-bus';
import { getLogger } from '../core/logger';

/**
 * JS-Slash-Runner 兼容的变量 API
 */
export const variables = {
  /**
   * 获取变量
   * @example variables.get('myVar')
   */
  get(key: string, scope?: VariableScope): VariableValue | undefined {
    return getVariableManager().get(key, { scope });
  },

  /**
   * 设置变量
   * @example variables.set('myVar', 'value')
   */
  set(key: string, value: VariableValue, scope?: VariableScope): void {
    getVariableManager().set(key, value, { scope });
  },

  /**
   * 删除变量
   */
  delete(key: string, scope?: VariableScope): boolean {
    return getVariableManager().delete(key, { scope });
  },

  /**
   * 获取全局变量
   */
  getGlobal(key: string): VariableValue | undefined {
    return getVariableManager().get(key, { scope: 'global' });
  },

  /**
   * 设置全局变量
   */
  setGlobal(key: string, value: VariableValue): void {
    getVariableManager().set(key, value, { scope: 'global' });
  },

  /**
   * 获取聊天变量
   */
  getChat(key: string): VariableValue | undefined {
    return getVariableManager().get(key, { scope: 'chat' });
  },

  /**
   * 设置聊天变量
   */
  setChat(key: string, value: VariableValue): void {
    getVariableManager().set(key, value, { scope: 'chat' });
  },

  /**
   * 增加变量值
   */
  incr(key: string, amount = 1, scope?: VariableScope): number {
    return getVariableManager().increment(key, amount, { scope });
  },

  /**
   * 减少变量值
   */
  decr(key: string, amount = 1, scope?: VariableScope): number {
    return getVariableManager().decrement(key, amount, { scope });
  },
};

/**
 * JS-Slash-Runner 兼容的消息 API
 */
export const chat = {
  /**
   * 获取所有消息
   */
  getMessages(): ChatMessage[] {
    return getMessageManager().getAll();
  },

  /**
   * 获取最后一条消息
   */
  getLastMessage(role?: MessageRole): ChatMessage | undefined {
    return getMessageManager().getLast(role);
  },

  /**
   * 获取最后 N 条消息
   */
  getLastMessages(count: number): ChatMessage[] {
    return getMessageManager().getLastN(count);
  },

  /**
   * 按索引获取消息
   */
  getMessage(index: number): ChatMessage | undefined {
    return getMessageManager().at(index);
  },

  /**
   * 获取消息数量
   */
  getMessageCount(): number {
    return getMessageManager().count();
  },

  /**
   * 添加消息
   */
  addMessage(role: MessageRole, content: string, name?: string): ChatMessage {
    return getMessageManager().create({ role, content, name });
  },

  /**
   * 更新消息内容
   */
  setMessageContent(messageId: number, content: string): void {
    getMessageManager().setContent(messageId, content);
  },

  /**
   * 删除消息
   */
  deleteMessage(messageId: number): boolean {
    return getMessageManager().delete(messageId);
  },

  /**
   * 隐藏消息
   */
  hideMessage(messageId: number): void {
    getMessageManager().hide(messageId);
  },

  /**
   * 显示消息
   */
  showMessage(messageId: number): void {
    getMessageManager().show(messageId);
  },

  /**
   * 添加 swipe
   */
  addSwipe(messageId: number, content: string): number {
    return getMessageManager().addSwipe(messageId, content);
  },

  /**
   * 切换 swipe
   */
  goToSwipe(messageId: number, swipeId: number): string {
    return getMessageManager().switchSwipe(messageId, swipeId);
  },

  /**
   * 下一个 swipe
   */
  nextSwipe(messageId: number): string | undefined {
    return getMessageManager().nextSwipe(messageId);
  },

  /**
   * 上一个 swipe
   */
  prevSwipe(messageId: number): string | undefined {
    return getMessageManager().prevSwipe(messageId);
  },
};

/**
 * JS-Slash-Runner 兼容的生成 API
 */
export const generate = {
  /**
   * 生成回复
   */
  async run(config?: GenerateConfig): Promise<GenerateResult> {
    return getGenerateManager().generate(config);
  },

  /**
   * 原始生成
   */
  async raw(prompts: AIMessage[], config?: GenerateConfig): Promise<GenerateResult> {
    return getGenerateManager().generateRaw(prompts, config);
  },

  /**
   * 中止当前生成
   */
  abort(): boolean {
    return getGenerateManager().abort();
  },

  /**
   * 检查是否正在生成
   */
  isGenerating(): boolean {
    return getGenerateManager().isGenerating();
  },
};

/**
 * JS-Slash-Runner 兼容的宏 API
 */
export const macros = {
  /**
   * 处理文本中的宏
   */
  async parse(text: string, context?: Partial<MacroContext>): Promise<string> {
    return getMacroManager().process(text, context);
  },

  /**
   * 注册自定义宏
   */
  register(
    name: string,
    pattern: string | RegExp,
    handler: (...args: string[]) => string | Promise<string>
  ): () => void {
    return getMacroManager().register({
      name,
      pattern: typeof pattern === 'string' ? new RegExp(pattern, 'gi') : pattern,
      handler: (ctx, match, ...args) => handler(...args),
    });
  },

  /**
   * 注册简单宏
   */
  registerSimple(name: string, replacement: string | (() => string)): () => void {
    return getMacroManager().registerSimple(name, replacement);
  },

  /**
   * 注销宏
   */
  unregister(name: string): boolean {
    return getMacroManager().unregister(name);
  },

  /**
   * 检查是否包含宏
   */
  hasMacros(text: string): boolean {
    return getMacroManager().hasMacros(text);
  },
};

/**
 * JS-Slash-Runner 兼容的注入 API
 */
export const inject = {
  /**
   * 添加注入
   */
  add(
    content: string,
    position: InjectionPosition,
    options?: { depth?: number; once?: boolean; id?: string }
  ): string {
    return getInjectManager().add(content, position, options);
  },

  /**
   * 添加到开头
   */
  before(content: string, options?: { once?: boolean }): string {
    return getInjectManager().addBefore(content, options);
  },

  /**
   * 添加到末尾
   */
  after(content: string, options?: { once?: boolean }): string {
    return getInjectManager().addAfter(content, options);
  },

  /**
   * 按深度添加
   */
  atDepth(content: string, depth: number, options?: { once?: boolean }): string {
    return getInjectManager().addInChat(content, depth, options);
  },

  /**
   * 移除注入
   */
  remove(id: string): boolean {
    return getInjectManager().remove(id);
  },

  /**
   * 移除所有注入
   */
  removeAll(): number {
    return getInjectManager().removeAll();
  },
};

/**
 * JS-Slash-Runner 兼容的事件 API
 */
export const events = {
  /**
   * 注册事件监听器
   */
  on<T = unknown>(event: string, callback: (data: T) => void | Promise<void>): () => void {
    return getEventBus().on(event, callback);
  },

  /**
   * 注册一次性事件监听器
   */
  once<T = unknown>(event: string, callback: (data: T) => void | Promise<void>): () => void {
    return getEventBus().once(event, callback);
  },

  /**
   * 注册最先执行的监听器
   */
  makeFirst<T = unknown>(event: string, callback: (data: T) => void | Promise<void>): () => void {
    return getEventBus().makeFirst(event, callback);
  },

  /**
   * 注册最后执行的监听器
   */
  makeLast<T = unknown>(event: string, callback: (data: T) => void | Promise<void>): () => void {
    return getEventBus().makeLast(event, callback);
  },

  /**
   * 触发事件
   */
  emit<T = unknown>(event: string, data?: T): Promise<void> {
    return getEventBus().emit(event, data);
  },

  /**
   * 移除事件监听器
   */
  off<T = unknown>(event: string, callback: EventListener<T>): boolean {
    return getEventBus().removeListener(event, callback);
  },
};

/**
 * JS-Slash-Runner 兼容的日志 API
 */
export const log = {
  debug: (message: string, data?: unknown) => getLogger().debug(message, data),
  info: (message: string, data?: unknown) => getLogger().info(message, data),
  warn: (message: string, data?: unknown) => getLogger().warn(message, data),
  error: (message: string, data?: unknown) => getLogger().error(message, data),
};

/**
 * 创建 SillyTavern 兼容的全局对象
 * 可以挂载到 window 上供脚本使用
 */
export function createSTCompatAPI() {
  return {
    // 变量系统
    variables,
    getvar: variables.get,
    setvar: variables.set,
    getglobalvar: variables.getGlobal,
    setglobalvar: variables.setGlobal,
    getchatvar: variables.getChat,
    setchatvar: variables.setChat,

    // 消息系统
    chat,
    getMessages: chat.getMessages,
    getLastMessage: chat.getLastMessage,
    getMessage: chat.getMessage,
    addMessage: chat.addMessage,

    // 生成系统
    generate: generate.run,
    generateRaw: generate.raw,
    abortGenerate: generate.abort,

    // 宏系统
    macros,
    parseMacros: macros.parse,
    registerMacro: macros.register,

    // 注入系统
    inject,
    injectPrompt: inject.add,

    // 事件系统
    events,
    eventSource: {
      on: events.on,
      once: events.once,
      makeFirst: events.makeFirst,
      makeLast: events.makeLast,
      emit: events.emit,
    },

    // 日志
    log,
  };
}

/**
 * 安装兼容层到全局对象
 */
export function installSTCompat(target: Record<string, unknown> = {}): void {
  const api = createSTCompatAPI();
  Object.assign(target, api);
  
  // 也可以作为 TavernHelper 的别名
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>).STCompat = api;
  }
}
