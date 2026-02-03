'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 画廊图片
 */
export interface GalleryImage {
  id: string;
  characterId: string;
  url: string; // 图片URL或base64
  name: string;
  description?: string;
  tags: string[];
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 排序方式
 */
export type GallerySortBy = 'name' | 'date' | 'favorite';
export type GallerySortOrder = 'asc' | 'desc';

interface GalleryStore {
  // 图片库
  images: GalleryImage[];
  
  // 设置
  sortBy: GallerySortBy;
  sortOrder: GallerySortOrder;
  viewMode: 'grid' | 'list';
  
  // Actions
  setSortBy: (sortBy: GallerySortBy) => void;
  setSortOrder: (sortOrder: GallerySortOrder) => void;
  setViewMode: (viewMode: 'grid' | 'list') => void;
  
  // 图片管理
  addImage: (image: Omit<GalleryImage, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateImage: (id: string, updates: Partial<GalleryImage>) => void;
  removeImage: (id: string) => void;
  getImage: (id: string) => GalleryImage | undefined;
  
  // 按角色获取图片
  getImagesByCharacter: (characterId: string) => GalleryImage[];
  
  // 收藏
  toggleFavorite: (id: string) => void;
  
  // 标签
  addTag: (id: string, tag: string) => void;
  removeTag: (id: string, tag: string) => void;
  
  // 搜索
  searchImages: (query: string, characterId?: string) => GalleryImage[];
  
  // 排序后的图片
  getSortedImages: (characterId?: string) => GalleryImage[];
  
  // 重置
  reset: () => void;
}

export const useGalleryStore = create<GalleryStore>()(
  persist(
    (set, get) => ({
      images: [],
      sortBy: 'date',
      sortOrder: 'desc',
      viewMode: 'grid',

      setSortBy: (sortBy) => set({ sortBy }),
      setSortOrder: (sortOrder) => set({ sortOrder }),
      setViewMode: (viewMode) => set({ viewMode }),

      addImage: (image) => {
        const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        const newImage: GalleryImage = {
          ...image,
          id,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          images: [...state.images, newImage],
        }));
        return id;
      },

      updateImage: (id, updates) => {
        set((state) => ({
          images: state.images.map((img) =>
            img.id === id
              ? { ...img, ...updates, updatedAt: Date.now() }
              : img
          ),
        }));
      },

      removeImage: (id) => {
        set((state) => ({
          images: state.images.filter((img) => img.id !== id),
        }));
      },

      getImage: (id) => {
        return get().images.find((img) => img.id === id);
      },

      getImagesByCharacter: (characterId) => {
        return get().images.filter((img) => img.characterId === characterId);
      },

      toggleFavorite: (id) => {
        set((state) => ({
          images: state.images.map((img) =>
            img.id === id
              ? { ...img, isFavorite: !img.isFavorite, updatedAt: Date.now() }
              : img
          ),
        }));
      },

      addTag: (id, tag) => {
        set((state) => ({
          images: state.images.map((img) =>
            img.id === id && !img.tags.includes(tag)
              ? { ...img, tags: [...img.tags, tag], updatedAt: Date.now() }
              : img
          ),
        }));
      },

      removeTag: (id, tag) => {
        set((state) => ({
          images: state.images.map((img) =>
            img.id === id
              ? { ...img, tags: img.tags.filter((t) => t !== tag), updatedAt: Date.now() }
              : img
          ),
        }));
      },

      searchImages: (query, characterId) => {
        const lowerQuery = query.toLowerCase();
        return get().images.filter((img) => {
          if (characterId && img.characterId !== characterId) return false;
          return (
            img.name.toLowerCase().includes(lowerQuery) ||
            img.description?.toLowerCase().includes(lowerQuery) ||
            img.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
          );
        });
      },

      getSortedImages: (characterId) => {
        const { images, sortBy, sortOrder } = get();
        let filtered = characterId
          ? images.filter((img) => img.characterId === characterId)
          : images;

        return filtered.sort((a, b) => {
          let comparison = 0;
          switch (sortBy) {
            case 'name':
              comparison = a.name.localeCompare(b.name);
              break;
            case 'date':
              comparison = a.createdAt - b.createdAt;
              break;
            case 'favorite':
              comparison = (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0);
              break;
          }
          return sortOrder === 'asc' ? comparison : -comparison;
        });
      },

      reset: () => {
        set({
          images: [],
          sortBy: 'date',
          sortOrder: 'desc',
          viewMode: 'grid',
        });
      },
    }),
    {
      name: 'tavern-gallery-storage',
    }
  )
);
