/**
 * TavernHelper 消息管理器
 * 提供高层 API、批量操作和事件触发
 */

import type {
  ChatMessage,
  MessageRole,
  NewMessage,
  MessageUpdate,
  GetMessagesOptions,
  CreateMessagesOptions,
} from '../core/types';
import {
  getMessageStore,
  type MessageCreatedEvent,
  type MessageUpdatedEvent,
  type MessageDeletedEvent,
  type SwipeChangedEvent,
} from './store';
import { getEventBus } from '../core/event-bus';
import { getLogger } from '../core/logger';

/** 消息管理器类 */
export class MessageManager {
  private logger = getLogger().withSource('MessageManager');

  /**
   * 获取消息存储
   */
  private get store() {
    return getMessageStore();
  }

  // ============ 聊天管理 ============

  /**
   * 设置当前聊天
   */
  setCurrentChat(chatId: number): void {
    this.store.setCurrentChat(chatId);
    this.logger.debug(`Current chat set to: ${chatId}`);
  }

  /**
   * 获取当前聊天 ID
   */
  getCurrentChatId(): number {
    return this.store.getCurrentChatId();
  }

  // ============ 消息 CRUD ============

  /**
   * 创建消息
   */
  create(message: NewMessage, options?: CreateMessagesOptions): ChatMessage {
    return this.store.create(message);
  }

  /**
   * 批量创建消息
   */
  createMany(messages: NewMessage[], options?: CreateMessagesOptions): ChatMessage[] {
    return messages.map((msg) => this.store.create(msg));
  }

  /**
   * 添加用户消息
   */
  addUserMessage(content: string, name?: string): ChatMessage {
    return this.store.create({
      role: 'user',
      content,
      name,
    });
  }

  /**
   * 添加助手消息
   */
  addAssistantMessage(content: string, name?: string): ChatMessage {
    return this.store.create({
      role: 'assistant',
      content,
      name,
    });
  }

  /**
   * 添加系统消息
   */
  addSystemMessage(content: string): ChatMessage {
    return this.store.create({
      role: 'system',
      content,
      isHidden: true,
    });
  }

  /**
   * 获取消息
   */
  get(messageId: number): ChatMessage | undefined {
    return this.store.get(messageId);
  }

  /**
   * 获取所有消息
   */
  getAll(options?: GetMessagesOptions): ChatMessage[] {
    return this.store.getByChat(undefined, options);
  }

  /**
   * 获取最后一条消息
   */
  getLast(role?: MessageRole): ChatMessage | undefined {
    return this.store.getLast(undefined, role);
  }

  /**
   * 获取最后 N 条消息
   */
  getLastN(count: number): ChatMessage[] {
    return this.store.getLastN(count);
  }

  /**
   * 按索引获取消息（支持负索引）
   */
  at(index: number): ChatMessage | undefined {
    return this.store.getByIndex(index);
  }

  /**
   * 更新消息
   */
  update(messageId: number, changes: Partial<Omit<MessageUpdate, 'messageId'>>): ChatMessage {
    return this.store.update({ messageId, ...changes });
  }

  /**
   * 更新消息内容
   */
  setContent(messageId: number, content: string): ChatMessage {
    return this.store.update({ messageId, content });
  }

  /**
   * 删除消息
   */
  delete(messageId: number): boolean {
    return this.store.delete(messageId);
  }

  /**
   * 删除多条消息
   */
  deleteMany(messageIds: number[]): number {
    return this.store.deleteMany(messageIds);
  }

  /**
   * 清空所有消息
   */
  clear(): number {
    return this.store.deleteByChat();
  }

  // ============ 消息查询 ============

  /**
   * 获取消息数量
   */
  count(): number {
    return this.store.count();
  }

  /**
   * 搜索消息
   */
  search(query: string | RegExp): ChatMessage[] {
    return this.store.search(query);
  }

  /**
   * 查找消息索引
   */
  indexOf(messageId: number): number {
    return this.store.findIndex(messageId);
  }

  /**
   * 过滤消息
   */
  filter(predicate: (message: ChatMessage) => boolean): ChatMessage[] {
    return this.getAll().filter(predicate);
  }

  /**
   * 查找第一条匹配的消息
   */
  find(predicate: (message: ChatMessage) => boolean): ChatMessage | undefined {
    return this.getAll().find(predicate);
  }

  /**
   * 获取用户消息
   */
  getUserMessages(): ChatMessage[] {
    return this.getAll({ role: 'user' });
  }

  /**
   * 获取助手消息
   */
  getAssistantMessages(): ChatMessage[] {
    return this.getAll({ role: 'assistant' });
  }

  /**
   * 获取可见消息
   */
  getVisibleMessages(): ChatMessage[] {
    return this.getAll({ hideState: 'unhidden' });
  }

  /**
   * 获取隐藏消息
   */
  getHiddenMessages(): ChatMessage[] {
    return this.getAll({ hideState: 'hidden' });
  }

  // ============ 隐藏/显示 ============

  /**
   * 隐藏消息
   */
  hide(messageId: number): void {
    this.store.update({ messageId, isHidden: true });
  }

  /**
   * 显示消息
   */
  show(messageId: number): void {
    this.store.update({ messageId, isHidden: false });
  }

  /**
   * 切换消息可见性
   */
  toggleVisibility(messageId: number): boolean {
    const message = this.store.getOrThrow(messageId);
    const newState = !message.isHidden;
    this.store.update({ messageId, isHidden: newState });
    return newState;
  }

  // ============ Swipe 操作 ============

  /**
   * 添加新的 swipe
   */
  addSwipe(messageId: number, content: string): number {
    return this.store.addSwipe(messageId, content);
  }

  /**
   * 切换到指定 swipe
   */
  switchSwipe(messageId: number, swipeId: number): string {
    return this.store.switchSwipe(messageId, swipeId);
  }

  /**
   * 下一个 swipe
   */
  nextSwipe(messageId: number): string | undefined {
    return this.store.nextSwipe(messageId);
  }

  /**
   * 上一个 swipe
   */
  prevSwipe(messageId: number): string | undefined {
    return this.store.prevSwipe(messageId);
  }

  /**
   * 获取 swipe 数量
   */
  getSwipeCount(messageId: number): number {
    return this.store.getSwipeCount(messageId);
  }

  /**
   * 获取当前 swipe ID
   */
  getCurrentSwipeId(messageId: number): number {
    return this.store.getCurrentSwipeId(messageId);
  }

  /**
   * 获取所有 swipe 内容
   */
  getSwipes(messageId: number): string[] {
    const message = this.store.getOrThrow(messageId);
    return [...message.swipes];
  }

  /**
   * 删除 swipe
   */
  deleteSwipe(messageId: number, swipeId: number): boolean {
    return this.store.deleteSwipe(messageId, swipeId);
  }

  // ============ 消息重排 ============

  /**
   * 移动消息到新位置
   */
  move(messageId: number, newIndex: number): void {
    this.store.move(messageId, newIndex);
  }

  /**
   * 交换两条消息
   */
  swap(messageId1: number, messageId2: number): void {
    this.store.swap(messageId1, messageId2);
  }

  /**
   * 将消息移到最后
   */
  moveToEnd(messageId: number): void {
    this.store.move(messageId, this.count());
  }

  /**
   * 将消息移到开头
   */
  moveToStart(messageId: number): void {
    this.store.move(messageId, 0);
  }

  // ============ 事件监听 ============

  /**
   * 监听消息创建
   */
  onCreated(callback: (event: MessageCreatedEvent) => void): () => void {
    return getEventBus().on('message:created', callback);
  }

  /**
   * 监听消息更新
   */
  onUpdated(callback: (event: MessageUpdatedEvent) => void): () => void {
    return getEventBus().on('message:updated', callback);
  }

  /**
   * 监听消息删除
   */
  onDeleted(callback: (event: MessageDeletedEvent) => void): () => void {
    return getEventBus().on('message:deleted', callback);
  }

  /**
   * 监听 swipe 切换
   */
  onSwipeChanged(callback: (event: SwipeChangedEvent) => void): () => void {
    return getEventBus().on('message:swipe_changed', callback);
  }

  // ============ 导入导出 ============

  /**
   * 导出消息
   */
  export(): ChatMessage[] {
    return this.store.export();
  }

  /**
   * 导出为 JSON
   */
  exportJSON(): string {
    return JSON.stringify(this.export(), null, 2);
  }

  /**
   * 导入消息
   */
  import(messages: ChatMessage[]): void {
    this.store.import(messages);
  }

  /**
   * 从 JSON 导入
   */
  importJSON(json: string): void {
    const messages = JSON.parse(json) as ChatMessage[];
    this.import(messages);
  }

  // ============ 工具方法 ============

  /**
   * 获取消息历史字符串
   */
  getHistoryText(separator = '\n\n'): string {
    return this.getVisibleMessages()
      .map((m) => `${m.name}: ${m.content}`)
      .join(separator);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return this.store.getStats();
  }

  /**
   * 遍历消息
   */
  forEach(callback: (message: ChatMessage, index: number) => void): void {
    this.getAll().forEach(callback);
  }

  /**
   * 映射消息
   */
  map<T>(callback: (message: ChatMessage, index: number) => T): T[] {
    return this.getAll().map(callback);
  }

  /**
   * 转换为数组
   */
  toArray(): ChatMessage[] {
    return this.getAll();
  }
}

/** 全局消息管理器单例 */
let globalManager: MessageManager | null = null;

/**
 * 获取全局消息管理器实例
 */
export function getMessageManager(): MessageManager {
  if (!globalManager) {
    globalManager = new MessageManager();
  }
  return globalManager;
}

/**
 * 重置全局消息管理器（主要用于测试）
 */
export function resetMessageManager(): void {
  globalManager = null;
}

// ============ 便捷函数 ============

/**
 * 获取所有消息
 */
export function getMessages(options?: GetMessagesOptions): ChatMessage[] {
  return getMessageManager().getAll(options);
}

/**
 * 获取最后一条消息
 */
export function getLastMessage(role?: MessageRole): ChatMessage | undefined {
  return getMessageManager().getLast(role);
}

/**
 * 添加消息
 */
export function addMessage(message: NewMessage): ChatMessage {
  return getMessageManager().create(message);
}

/**
 * 更新消息
 */
export function updateMessage(messageId: number, changes: Partial<MessageUpdate>): ChatMessage {
  return getMessageManager().update(messageId, changes);
}

/**
 * 删除消息
 */
export function deleteMessage(messageId: number): boolean {
  return getMessageManager().delete(messageId);
}
