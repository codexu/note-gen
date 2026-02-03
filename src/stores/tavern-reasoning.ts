'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 思考过程类型
 */
export type ReasoningType = 'model' | 'parsed' | 'manual' | 'edited';

/**
 * 思考过程状态
 */
export type ReasoningState = 'none' | 'thinking' | 'done' | 'hidden';

/**
 * 消息的思考过程数据
 */
export interface MessageReasoning {
  messageId: string;
  reasoning: string;
  reasoningType: ReasoningType;
  state: ReasoningState;
  duration?: number; // 思考时长 (毫秒)
  startTime?: number;
  endTime?: number;
}

/**
 * 思考过程设置
 */
export interface ReasoningSettings {
  enabled: boolean;
  autoExpand: boolean; // 自动展开思考过程
  autoParse: boolean; // 自动解析 <think> 标签
  showHidden: boolean; // 显示隐藏的思考过程
  addToPrompts: boolean; // 将思考过程添加到提示词
  maxAdditions: number; // 最大添加数量
  prefix: string; // 思考过程前缀标签
  suffix: string; // 思考过程后缀标签
  separator: string; // 分隔符
}

interface ReasoningStore {
  // 设置
  settings: ReasoningSettings;
  
  // 消息思考过程缓存
  messageReasonings: Record<string, MessageReasoning>;
  
  // 当前正在思考的消息ID
  thinkingMessageId: string | null;
  
  // Actions
  updateSettings: (settings: Partial<ReasoningSettings>) => void;
  
  // 消息思考过程管理
  setMessageReasoning: (messageId: string, reasoning: Partial<MessageReasoning>) => void;
  getMessageReasoning: (messageId: string) => MessageReasoning | undefined;
  clearMessageReasoning: (messageId: string) => void;
  
  // 思考状态管理
  startThinking: (messageId: string) => void;
  updateThinking: (messageId: string, reasoning: string) => void;
  finishThinking: (messageId: string, reasoning?: string) => void;
  
  // 解析思考过程
  parseReasoningFromText: (text: string) => { reasoning: string; content: string } | null;
  
  // 重置
  reset: () => void;
}

const defaultSettings: ReasoningSettings = {
  enabled: true,
  autoExpand: false,
  autoParse: true,
  showHidden: false,
  addToPrompts: false,
  maxAdditions: 3,
  prefix: '<think>',
  suffix: '</think>',
  separator: '\n\n',
};

export const useReasoningStore = create<ReasoningStore>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      messageReasonings: {},
      thinkingMessageId: null,

      updateSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },

      setMessageReasoning: (messageId, reasoning) => {
        set((state) => ({
          messageReasonings: {
            ...state.messageReasonings,
            [messageId]: {
              ...state.messageReasonings[messageId],
              messageId,
              ...reasoning,
            } as MessageReasoning,
          },
        }));
      },

      getMessageReasoning: (messageId) => {
        return get().messageReasonings[messageId];
      },

      clearMessageReasoning: (messageId) => {
        set((state) => {
          const { [messageId]: _, ...rest } = state.messageReasonings;
          return { messageReasonings: rest };
        });
      },

      startThinking: (messageId) => {
        const now = Date.now();
        set((state) => ({
          thinkingMessageId: messageId,
          messageReasonings: {
            ...state.messageReasonings,
            [messageId]: {
              messageId,
              reasoning: '',
              reasoningType: 'model',
              state: 'thinking',
              startTime: now,
            },
          },
        }));
      },

      updateThinking: (messageId, reasoning) => {
        set((state) => ({
          messageReasonings: {
            ...state.messageReasonings,
            [messageId]: {
              ...state.messageReasonings[messageId],
              reasoning,
            },
          },
        }));
      },

      finishThinking: (messageId, reasoning) => {
        const now = Date.now();
        const current = get().messageReasonings[messageId];
        const duration = current?.startTime ? now - current.startTime : undefined;
        
        set((state) => ({
          thinkingMessageId: null,
          messageReasonings: {
            ...state.messageReasonings,
            [messageId]: {
              ...state.messageReasonings[messageId],
              reasoning: reasoning ?? state.messageReasonings[messageId]?.reasoning ?? '',
              state: 'done',
              endTime: now,
              duration,
            },
          },
        }));
      },

      parseReasoningFromText: (text) => {
        const { settings } = get();
        if (!settings.autoParse || !settings.prefix || !settings.suffix) {
          return null;
        }

        const prefixIndex = text.indexOf(settings.prefix);
        if (prefixIndex === -1) {
          return null;
        }

        const suffixIndex = text.indexOf(settings.suffix, prefixIndex + settings.prefix.length);
        if (suffixIndex === -1) {
          // 思考过程未结束，返回部分内容
          const reasoning = text.slice(prefixIndex + settings.prefix.length);
          return {
            reasoning: reasoning.trim(),
            content: '',
          };
        }

        const reasoning = text.slice(prefixIndex + settings.prefix.length, suffixIndex);
        const content = text.slice(suffixIndex + settings.suffix.length);
        
        return {
          reasoning: reasoning.trim(),
          content: content.trim(),
        };
      },

      reset: () => {
        set({
          settings: defaultSettings,
          messageReasonings: {},
          thinkingMessageId: null,
        });
      },
    }),
    {
      name: 'tavern-reasoning-storage',
      partialize: (state) => ({
        settings: state.settings,
      }),
    }
  )
);
