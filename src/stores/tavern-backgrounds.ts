'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 背景适配模式
 */
export type BackgroundFitting = 'cover' | 'contain' | 'stretch' | 'center' | 'tile';

/**
 * 背景配置
 */
export interface BackgroundConfig {
  id: string;
  name: string;
  url: string; // 图片URL或base64
  isCustom: boolean; // 是否为用户上传
  fitting: BackgroundFitting;
  opacity: number; // 0-100
  blur: number; // 0-20
  brightness: number; // 0-200
  createdAt: number;
}

/**
 * 角色/聊天专属背景
 */
export interface ChatBackground {
  chatId: string;
  backgroundId: string | null; // null 表示使用全局背景
}

interface BackgroundsStore {
  // 全局背景设置
  globalBackgroundId: string | null;
  globalFitting: BackgroundFitting;
  globalOpacity: number;
  globalBlur: number;
  globalBrightness: number;
  
  // 背景库
  backgrounds: BackgroundConfig[];
  
  // 聊天专属背景
  chatBackgrounds: Record<string, string | null>;
  
  // 是否启用背景
  enabled: boolean;
  
  // Actions
  setEnabled: (enabled: boolean) => void;
  setGlobalBackground: (backgroundId: string | null) => void;
  setGlobalSettings: (settings: {
    fitting?: BackgroundFitting;
    opacity?: number;
    blur?: number;
    brightness?: number;
  }) => void;
  
  // 背景管理
  addBackground: (background: Omit<BackgroundConfig, 'id' | 'createdAt'>) => string;
  updateBackground: (id: string, updates: Partial<BackgroundConfig>) => void;
  removeBackground: (id: string) => void;
  getBackground: (id: string) => BackgroundConfig | undefined;
  
  // 聊天背景
  setChatBackground: (chatId: string, backgroundId: string | null) => void;
  getChatBackground: (chatId: string) => string | null;
  clearChatBackground: (chatId: string) => void;
  
  // 获取当前应该显示的背景
  getCurrentBackground: (chatId?: string) => BackgroundConfig | null;
  
  // 重置
  reset: () => void;
}

// 预设背景
const defaultBackgrounds: BackgroundConfig[] = [
  {
    id: 'transparent',
    name: '透明',
    url: '',
    isCustom: false,
    fitting: 'cover',
    opacity: 100,
    blur: 0,
    brightness: 100,
    createdAt: 0,
  },
];

export const useBackgroundsStore = create<BackgroundsStore>()(
  persist(
    (set, get) => ({
      globalBackgroundId: null,
      globalFitting: 'cover',
      globalOpacity: 100,
      globalBlur: 0,
      globalBrightness: 100,
      backgrounds: defaultBackgrounds,
      chatBackgrounds: {},
      enabled: true,

      setEnabled: (enabled) => set({ enabled }),

      setGlobalBackground: (backgroundId) => set({ globalBackgroundId: backgroundId }),

      setGlobalSettings: (settings) => {
        set((state) => ({
          globalFitting: settings.fitting ?? state.globalFitting,
          globalOpacity: settings.opacity ?? state.globalOpacity,
          globalBlur: settings.blur ?? state.globalBlur,
          globalBrightness: settings.brightness ?? state.globalBrightness,
        }));
      },

      addBackground: (background) => {
        const id = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newBackground: BackgroundConfig = {
          ...background,
          id,
          createdAt: Date.now(),
        };
        set((state) => ({
          backgrounds: [...state.backgrounds, newBackground],
        }));
        return id;
      },

      updateBackground: (id, updates) => {
        set((state) => ({
          backgrounds: state.backgrounds.map((bg) =>
            bg.id === id ? { ...bg, ...updates } : bg
          ),
        }));
      },

      removeBackground: (id) => {
        set((state) => ({
          backgrounds: state.backgrounds.filter((bg) => bg.id !== id),
          globalBackgroundId: state.globalBackgroundId === id ? null : state.globalBackgroundId,
          chatBackgrounds: Object.fromEntries(
            Object.entries(state.chatBackgrounds).map(([chatId, bgId]) => [
              chatId,
              bgId === id ? null : bgId,
            ])
          ),
        }));
      },

      getBackground: (id) => {
        return get().backgrounds.find((bg) => bg.id === id);
      },

      setChatBackground: (chatId, backgroundId) => {
        set((state) => ({
          chatBackgrounds: {
            ...state.chatBackgrounds,
            [chatId]: backgroundId,
          },
        }));
      },

      getChatBackground: (chatId) => {
        return get().chatBackgrounds[chatId] ?? null;
      },

      clearChatBackground: (chatId) => {
        set((state) => {
          const { [chatId]: _, ...rest } = state.chatBackgrounds;
          return { chatBackgrounds: rest };
        });
      },

      getCurrentBackground: (chatId) => {
        const state = get();
        if (!state.enabled) return null;

        // 优先使用聊天专属背景
        const chatBgId = chatId ? state.chatBackgrounds[chatId] : null;
        const backgroundId = chatBgId ?? state.globalBackgroundId;

        if (!backgroundId) return null;
        return state.backgrounds.find((bg) => bg.id === backgroundId) ?? null;
      },

      reset: () => {
        set({
          globalBackgroundId: null,
          globalFitting: 'cover',
          globalOpacity: 100,
          globalBlur: 0,
          globalBrightness: 100,
          backgrounds: defaultBackgrounds,
          chatBackgrounds: {},
          enabled: true,
        });
      },
    }),
    {
      name: 'tavern-backgrounds-storage',
    }
  )
);
