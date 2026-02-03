'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 角色统计数据
 */
export interface CharacterStats {
  characterId: string;
  totalGenTime: number; // 总生成时间 (毫秒)
  userMsgCount: number; // 用户消息数
  charMsgCount: number; // 角色消息数
  userWordCount: number; // 用户字数
  charWordCount: number; // 角色字数
  totalSwipeCount: number; // 总 swipe 次数
  dateFirstChat: number; // 首次聊天时间
  dateLastChat: number; // 最后聊天时间
}

/**
 * 全局统计数据
 */
export interface GlobalStats {
  totalChats: number;
  totalMessages: number;
  totalCharacters: number;
  totalGenTime: number;
  totalUserWords: number;
  totalCharWords: number;
}

interface StatsStore {
  // 角色统计
  characterStats: Record<string, CharacterStats>;
  
  // 是否启用统计
  enabled: boolean;
  
  // Actions
  setEnabled: (enabled: boolean) => void;
  
  // 更新角色统计
  updateCharacterStats: (characterId: string, updates: Partial<CharacterStats>) => void;
  getCharacterStats: (characterId: string) => CharacterStats | undefined;
  
  // 记录消息
  recordMessage: (params: {
    characterId: string;
    isUser: boolean;
    wordCount: number;
    genTime?: number;
    isSwipe?: boolean;
  }) => void;
  
  // 计算全局统计
  getGlobalStats: () => GlobalStats;
  
  // 重置
  resetCharacterStats: (characterId: string) => void;
  resetAllStats: () => void;
}

/**
 * 计算字数
 */
export function countWords(text: string): number {
  // 中文按字符计数，英文按单词计数
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/\b[a-zA-Z]+\b/g) || []).length;
  return chineseChars + englishWords;
}

export const useStatsStore = create<StatsStore>()(
  persist(
    (set, get) => ({
      characterStats: {},
      enabled: true,

      setEnabled: (enabled) => set({ enabled }),

      updateCharacterStats: (characterId, updates) => {
        set((state) => ({
          characterStats: {
            ...state.characterStats,
            [characterId]: {
              ...state.characterStats[characterId],
              characterId,
              ...updates,
            } as CharacterStats,
          },
        }));
      },

      getCharacterStats: (characterId) => {
        return get().characterStats[characterId];
      },

      recordMessage: ({ characterId, isUser, wordCount, genTime, isSwipe }) => {
        if (!get().enabled) return;

        const now = Date.now();
        const existing = get().characterStats[characterId];

        set((state) => ({
          characterStats: {
            ...state.characterStats,
            [characterId]: {
              characterId,
              totalGenTime: (existing?.totalGenTime ?? 0) + (genTime ?? 0),
              userMsgCount: (existing?.userMsgCount ?? 0) + (isUser ? 1 : 0),
              charMsgCount: (existing?.charMsgCount ?? 0) + (!isUser ? 1 : 0),
              userWordCount: (existing?.userWordCount ?? 0) + (isUser ? wordCount : 0),
              charWordCount: (existing?.charWordCount ?? 0) + (!isUser ? wordCount : 0),
              totalSwipeCount: (existing?.totalSwipeCount ?? 0) + (isSwipe ? 1 : 0),
              dateFirstChat: existing?.dateFirstChat ?? now,
              dateLastChat: now,
            },
          },
        }));
      },

      getGlobalStats: () => {
        const stats = get().characterStats;
        const characters = Object.values(stats);

        return {
          totalChats: characters.length,
          totalMessages: characters.reduce(
            (sum, c) => sum + c.userMsgCount + c.charMsgCount,
            0
          ),
          totalCharacters: characters.length,
          totalGenTime: characters.reduce((sum, c) => sum + c.totalGenTime, 0),
          totalUserWords: characters.reduce((sum, c) => sum + c.userWordCount, 0),
          totalCharWords: characters.reduce((sum, c) => sum + c.charWordCount, 0),
        };
      },

      resetCharacterStats: (characterId) => {
        set((state) => {
          const { [characterId]: _, ...rest } = state.characterStats;
          return { characterStats: rest };
        });
      },

      resetAllStats: () => {
        set({ characterStats: {} });
      },
    }),
    {
      name: 'tavern-stats-storage',
    }
  )
);
