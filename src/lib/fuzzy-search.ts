import { invoke } from '@tauri-apps/api/core';

// 匹配 Rust 类型的接口定义
export interface SearchItem {
  id?: string;
  desc?: string;
  title?: string;
  article?: string;
  url?: string;
  path?: string;
  searchType?: string;
  type?: string;
  tagId?: number;
  tagName?: string;
  content?: string;
  createdAt?: number;
  score?: number;
  matches?: MatchInfo;
}

// 匹配信息接口
export interface MatchInfo {
  key: string;
  indices: [number, number][];
  value: string;
}

// 模糊搜索结果接口
export interface FuzzySearchResult {
  item: SearchItem;
  refIndex: number;
  matches: MatchInfo[];
  score: number;
}

// 模糊搜索选项接口
export interface FuzzySearchOptions {
  keys: string[];
  threshold?: number;
  includeScore?: boolean;
  includeMatches?: boolean;
}

// Rust 模糊搜索包装类
export class RustFuzzySearch {
  private items: SearchItem[];
  private options: FuzzySearchOptions;

  // 构造函数
  constructor(items: any[], options: Partial<FuzzySearchOptions> = {}) {
    this.items = items;
    this.options = {
      keys: options.keys || [], // 确保有默认的键值
      threshold: 0.3,
      includeScore: true,
      includeMatches: true,
      ...options
    };
  }

  // 执行模糊搜索
  async search(query: string): Promise<FuzzySearchResult[]> {
    if (!query) return [];
    
    try {
      const rawResults = await invoke<Array<{item: SearchItem; refindex: number; score: number; matches: MatchInfo[]}>>('fuzzy_search', {
        items: this.items,
        query,
        keys: this.options.keys,
        threshold: this.options.threshold || 0.3,
        includeScore: this.options.includeScore ?? true,
        includeMatches: this.options.includeMatches ?? true
      });
      
      return rawResults.map((result: { item: SearchItem; refindex: number; score: number; matches: MatchInfo[] }) => {
        const item = result.item;
        if ('search_type' in item && typeof item.search_type === 'string') {
          item.searchType = item.search_type;
          delete item.search_type;
        }
        
        return {
        item: result.item,
        refIndex: result.refindex,
        score: result.score,
        matches: result.matches
      };
      });
    } catch (error) {
      console.error('模糊搜索出错:', error);
      return [];
    }
  }

  // 执行并行模糊搜索（适用于大数据集）
  async searchParallel(query: string): Promise<FuzzySearchResult[]> {
    if (!query) return [];
    
    try {
      const rawResults = await invoke<Array<{item: SearchItem; refindex: number; score: number; matches: MatchInfo[]}>>('fuzzy_search_parallel', {
        items: this.items,
        query,
        keys: this.options.keys,
        threshold: this.options.threshold || 0.3,
        includeScore: this.options.includeScore ?? true,
        includeMatches: this.options.includeMatches ?? true
      });

      return rawResults.map((result: { item: SearchItem; refindex: number; score: number; matches: MatchInfo[] }) => {
        const item = result.item;
        if ('search_type' in item && typeof item.search_type === 'string') {
          item.searchType = item.search_type;
          delete item.search_type;
        }

        return {
          item: result.item,
          refIndex: result.refindex,
          score: result.score,
          matches: result.matches
        };
      });
    } catch (error) {
      console.error('并行模糊搜索出错:', error);
      return [];
    }
  }
}
