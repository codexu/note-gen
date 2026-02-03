/**
 * TavernHelper 消息存储模块
 * 实现消息的存储、检索和 Swipe 管理
 */

import type {
  ChatMessage,
  MessageRole,
  MessageExtra,
  NewMessage,
  MessageUpdate,
  GetMessagesOptions,
} from '../core/types';
import { getEventBus } from '../core/event-bus';
import { getLogger } from '../core/logger';
import { MessageError, ErrorCode } from '../core/error-handler';

/** 消息创建事件数据 */
export interface MessageCreatedEvent {
  message: ChatMessage;
  chatId: number;
}

/** 消息更新事件数据 */
export interface MessageUpdatedEvent {
  messageId: number;
  chatId: number;
  changes: Partial<ChatMessage>;
  previous: ChatMessage;
}

/** 消息删除事件数据 */
export interface MessageDeletedEvent {
  messageId: number;
  chatId: number;
  message: ChatMessage;
}

/** Swipe 切换事件数据 */
export interface SwipeChangedEvent {
  messageId: number;
  chatId: number;
  previousSwipeId: number;
  newSwipeId: number;
  content: string;
}

/**
 * 消息存储类
 */
export class MessageStore {
  private messages: Map<number, ChatMessage> = new Map();
  private chatMessages: Map<number, number[]> = new Map(); // chatId -> messageIds
  private nextMessageId = 1;
  private currentChatId = 0;
  private logger = getLogger().withSource('MessageStore');

  /**
   * 设置当前聊天 ID
   */
  setCurrentChat(chatId: number): void {
    this.currentChatId = chatId;
    if (!this.chatMessages.has(chatId)) {
      this.chatMessages.set(chatId, []);
    }
  }

  /**
   * 获取当前聊天 ID
   */
  getCurrentChatId(): number {
    return this.currentChatId;
  }

  /**
   * 生成新的消息 ID
   */
  private generateMessageId(): number {
    return this.nextMessageId++;
  }

  /**
   * 创建新消息
   */
  create(message: NewMessage, chatId?: number): ChatMessage {
    const targetChatId = chatId ?? this.currentChatId;
    
    if (!targetChatId) {
      throw new MessageError(
        ErrorCode.INVALID_STATE,
        'No chat ID specified and no current chat set'
      );
    }

    const messageId = this.generateMessageId();
    const now = Date.now();

    const newMessage: ChatMessage = {
      messageId,
      chatId: targetChatId,
      name: message.name ?? (message.role === 'user' ? 'User' : 'Assistant'),
      role: message.role,
      content: message.content,
      isHidden: message.isHidden ?? false,
      swipeId: 0,
      swipes: [message.content],
      swipesData: [{}],
      extra: message.extra ?? {},
      sendDate: now,
    };

    // 存储消息
    this.messages.set(messageId, newMessage);

    // 添加到聊天消息列表
    if (!this.chatMessages.has(targetChatId)) {
      this.chatMessages.set(targetChatId, []);
    }
    this.chatMessages.get(targetChatId)!.push(messageId);

    // 触发事件
    getEventBus().emitSync<MessageCreatedEvent>('message:created', {
      message: newMessage,
      chatId: targetChatId,
    });

    this.logger.debug(`Message created: ${messageId}`, { role: message.role });

    return newMessage;
  }

  /**
   * 获取单条消息
   */
  get(messageId: number): ChatMessage | undefined {
    return this.messages.get(messageId);
  }

  /**
   * 获取消息（带验证）
   */
  getOrThrow(messageId: number): ChatMessage {
    const message = this.messages.get(messageId);
    if (!message) {
      throw new MessageError(
        ErrorCode.MESSAGE_NOT_FOUND,
        `Message not found: ${messageId}`,
        { data: { messageId } }
      );
    }
    return message;
  }

  /**
   * 获取聊天中的所有消息
   */
  getByChat(chatId?: number, options?: GetMessagesOptions): ChatMessage[] {
    const targetChatId = chatId ?? this.currentChatId;
    const messageIds = this.chatMessages.get(targetChatId) ?? [];
    
    let messages = messageIds
      .map((id) => this.messages.get(id))
      .filter((m): m is ChatMessage => m !== undefined);

    // 应用过滤器
    if (options?.role && options.role !== 'all') {
      messages = messages.filter((m) => m.role === options.role);
    }

    if (options?.hideState === 'hidden') {
      messages = messages.filter((m) => m.isHidden);
    } else if (options?.hideState === 'unhidden') {
      messages = messages.filter((m) => !m.isHidden);
    }

    return messages;
  }

  /**
   * 获取最后一条消息
   */
  getLast(chatId?: number, role?: MessageRole): ChatMessage | undefined {
    const messages = this.getByChat(chatId, { role: role ?? 'all' });
    return messages[messages.length - 1];
  }

  /**
   * 获取最后 N 条消息
   */
  getLastN(count: number, chatId?: number): ChatMessage[] {
    const messages = this.getByChat(chatId);
    return messages.slice(-count);
  }

  /**
   * 按索引获取消息
   */
  getByIndex(index: number, chatId?: number): ChatMessage | undefined {
    const messages = this.getByChat(chatId);
    if (index < 0) {
      return messages[messages.length + index];
    }
    return messages[index];
  }

  /**
   * 更新消息
   */
  update(update: MessageUpdate): ChatMessage {
    const message = this.getOrThrow(update.messageId);
    const previous = { ...message };

    // 应用更新
    if (update.name !== undefined) message.name = update.name;
    if (update.role !== undefined) message.role = update.role;
    if (update.content !== undefined) {
      message.content = update.content;
      // 同时更新当前 swipe
      message.swipes[message.swipeId] = update.content;
    }
    if (update.isHidden !== undefined) message.isHidden = update.isHidden;
    if (update.extra !== undefined) {
      message.extra = { ...message.extra, ...update.extra };
    }
    if (update.swipeId !== undefined) message.swipeId = update.swipeId;
    if (update.swipes !== undefined) message.swipes = update.swipes;
    if (update.swipesData !== undefined) message.swipesData = update.swipesData;

    // 触发事件
    getEventBus().emitSync<MessageUpdatedEvent>('message:updated', {
      messageId: update.messageId,
      chatId: message.chatId,
      changes: update,
      previous,
    });

    this.logger.debug(`Message updated: ${update.messageId}`);

    return message;
  }

  /**
   * 删除消息
   */
  delete(messageId: number): boolean {
    const message = this.messages.get(messageId);
    if (!message) return false;

    // 从存储中删除
    this.messages.delete(messageId);

    // 从聊天消息列表中删除
    const chatMessageIds = this.chatMessages.get(message.chatId);
    if (chatMessageIds) {
      const index = chatMessageIds.indexOf(messageId);
      if (index !== -1) {
        chatMessageIds.splice(index, 1);
      }
    }

    // 触发事件
    getEventBus().emitSync<MessageDeletedEvent>('message:deleted', {
      messageId,
      chatId: message.chatId,
      message,
    });

    this.logger.debug(`Message deleted: ${messageId}`);

    return true;
  }

  /**
   * 删除多条消息
   */
  deleteMany(messageIds: number[]): number {
    let count = 0;
    for (const id of messageIds) {
      if (this.delete(id)) count++;
    }
    return count;
  }

  /**
   * 删除聊天中的所有消息
   */
  deleteByChat(chatId?: number): number {
    const targetChatId = chatId ?? this.currentChatId;
    const messageIds = this.chatMessages.get(targetChatId) ?? [];
    const count = messageIds.length;

    for (const id of [...messageIds]) {
      this.delete(id);
    }

    return count;
  }

  // ============ Swipe 管理 ============

  /**
   * 添加新的 swipe
   */
  addSwipe(messageId: number, content: string, data?: Record<string, unknown>): number {
    const message = this.getOrThrow(messageId);
    
    message.swipes.push(content);
    message.swipesData.push(data ?? {});
    
    const newSwipeId = message.swipes.length - 1;
    
    this.logger.debug(`Swipe added: message ${messageId}, swipe ${newSwipeId}`);
    
    return newSwipeId;
  }

  /**
   * 切换到指定 swipe
   */
  switchSwipe(messageId: number, swipeId: number): string {
    const message = this.getOrThrow(messageId);
    
    if (swipeId < 0 || swipeId >= message.swipes.length) {
      throw new MessageError(
        ErrorCode.INVALID_ARGUMENT,
        `Invalid swipe ID: ${swipeId}`,
        { data: { messageId, swipeId, maxSwipeId: message.swipes.length - 1 } }
      );
    }

    const previousSwipeId = message.swipeId;
    message.swipeId = swipeId;
    message.content = message.swipes[swipeId];

    // 触发事件
    getEventBus().emitSync<SwipeChangedEvent>('message:swipe_changed', {
      messageId,
      chatId: message.chatId,
      previousSwipeId,
      newSwipeId: swipeId,
      content: message.content,
    });

    this.logger.debug(`Swipe switched: message ${messageId}, ${previousSwipeId} -> ${swipeId}`);

    return message.content;
  }

  /**
   * 切换到下一个 swipe
   */
  nextSwipe(messageId: number): string | undefined {
    const message = this.getOrThrow(messageId);
    
    if (message.swipeId >= message.swipes.length - 1) {
      return undefined; // 已经是最后一个
    }

    return this.switchSwipe(messageId, message.swipeId + 1);
  }

  /**
   * 切换到上一个 swipe
   */
  prevSwipe(messageId: number): string | undefined {
    const message = this.getOrThrow(messageId);
    
    if (message.swipeId <= 0) {
      return undefined; // 已经是第一个
    }

    return this.switchSwipe(messageId, message.swipeId - 1);
  }

  /**
   * 获取 swipe 数量
   */
  getSwipeCount(messageId: number): number {
    const message = this.getOrThrow(messageId);
    return message.swipes.length;
  }

  /**
   * 获取当前 swipe ID
   */
  getCurrentSwipeId(messageId: number): number {
    const message = this.getOrThrow(messageId);
    return message.swipeId;
  }

  /**
   * 更新当前 swipe 内容
   */
  updateCurrentSwipe(messageId: number, content: string): void {
    const message = this.getOrThrow(messageId);
    message.content = content;
    message.swipes[message.swipeId] = content;
  }

  /**
   * 删除指定 swipe
   */
  deleteSwipe(messageId: number, swipeId: number): boolean {
    const message = this.getOrThrow(messageId);
    
    if (message.swipes.length <= 1) {
      throw new MessageError(
        ErrorCode.INVALID_STATE,
        'Cannot delete the last swipe',
        { data: { messageId } }
      );
    }

    if (swipeId < 0 || swipeId >= message.swipes.length) {
      return false;
    }

    message.swipes.splice(swipeId, 1);
    message.swipesData.splice(swipeId, 1);

    // 调整当前 swipe ID
    if (message.swipeId >= swipeId) {
      message.swipeId = Math.max(0, message.swipeId - 1);
      message.content = message.swipes[message.swipeId];
    }

    return true;
  }

  // ============ 搜索和查询 ============

  /**
   * 搜索消息内容
   */
  search(query: string | RegExp, chatId?: number): ChatMessage[] {
    const messages = this.getByChat(chatId);
    
    return messages.filter((m) => {
      if (typeof query === 'string') {
        return m.content.toLowerCase().includes(query.toLowerCase());
      }
      return query.test(m.content);
    });
  }

  /**
   * 查找消息索引
   */
  findIndex(messageId: number, chatId?: number): number {
    const targetChatId = chatId ?? this.currentChatId;
    const messageIds = this.chatMessages.get(targetChatId) ?? [];
    return messageIds.indexOf(messageId);
  }

  /**
   * 获取消息总数
   */
  count(chatId?: number): number {
    const targetChatId = chatId ?? this.currentChatId;
    return this.chatMessages.get(targetChatId)?.length ?? 0;
  }

  // ============ 消息重排序 ============

  /**
   * 移动消息到新位置
   */
  move(messageId: number, newIndex: number, chatId?: number): void {
    const targetChatId = chatId ?? this.currentChatId;
    const messageIds = this.chatMessages.get(targetChatId);
    
    if (!messageIds) return;

    const currentIndex = messageIds.indexOf(messageId);
    if (currentIndex === -1) return;

    // 移除并插入到新位置
    messageIds.splice(currentIndex, 1);
    const insertIndex = Math.max(0, Math.min(newIndex, messageIds.length));
    messageIds.splice(insertIndex, 0, messageId);
  }

  /**
   * 交换两条消息的位置
   */
  swap(messageId1: number, messageId2: number, chatId?: number): void {
    const targetChatId = chatId ?? this.currentChatId;
    const messageIds = this.chatMessages.get(targetChatId);
    
    if (!messageIds) return;

    const index1 = messageIds.indexOf(messageId1);
    const index2 = messageIds.indexOf(messageId2);
    
    if (index1 === -1 || index2 === -1) return;

    messageIds[index1] = messageId2;
    messageIds[index2] = messageId1;
  }

  // ============ 批量导入导出 ============

  /**
   * 导出聊天消息
   */
  export(chatId?: number): ChatMessage[] {
    return this.getByChat(chatId);
  }

  /**
   * 导入聊天消息
   */
  import(messages: ChatMessage[], chatId?: number): void {
    const targetChatId = chatId ?? this.currentChatId;
    
    for (const msg of messages) {
      const newMsg = { ...msg, chatId: targetChatId };
      
      // 确保 ID 唯一
      if (this.messages.has(newMsg.messageId)) {
        newMsg.messageId = this.generateMessageId();
      } else {
        this.nextMessageId = Math.max(this.nextMessageId, newMsg.messageId + 1);
      }

      this.messages.set(newMsg.messageId, newMsg);
      
      if (!this.chatMessages.has(targetChatId)) {
        this.chatMessages.set(targetChatId, []);
      }
      this.chatMessages.get(targetChatId)!.push(newMsg.messageId);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(chatId?: number): {
    totalMessages: number;
    byRole: Record<MessageRole, number>;
    hiddenCount: number;
    totalSwipes: number;
  } {
    const messages = this.getByChat(chatId);
    
    const byRole: Record<MessageRole, number> = {
      user: 0,
      assistant: 0,
      system: 0,
    };
    
    let hiddenCount = 0;
    let totalSwipes = 0;

    for (const msg of messages) {
      byRole[msg.role]++;
      if (msg.isHidden) hiddenCount++;
      totalSwipes += msg.swipes.length;
    }

    return {
      totalMessages: messages.length,
      byRole,
      hiddenCount,
      totalSwipes,
    };
  }
}

/** 全局消息存储单例 */
let globalStore: MessageStore | null = null;

/**
 * 获取全局消息存储实例
 */
export function getMessageStore(): MessageStore {
  if (!globalStore) {
    globalStore = new MessageStore();
  }
  return globalStore;
}

/**
 * 重置全局消息存储（主要用于测试）
 */
export function resetMessageStore(): void {
  globalStore = null;
}
