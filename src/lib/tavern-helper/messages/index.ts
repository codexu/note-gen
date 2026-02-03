/**
 * TavernHelper 消息系统
 * 提供聊天消息管理、Swipe 操作
 */

// 存储
export {
  MessageStore,
  getMessageStore,
  resetMessageStore,
  type MessageCreatedEvent,
  type MessageUpdatedEvent,
  type MessageDeletedEvent,
  type SwipeChangedEvent,
} from './store';

// 管理器
export {
  MessageManager,
  getMessageManager,
  resetMessageManager,
  // 便捷函数
  getMessages,
  getLastMessage,
  addMessage,
  updateMessage,
  deleteMessage,
} from './manager';
