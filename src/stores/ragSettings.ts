import { create } from 'zustand';
import { Store } from "@tauri-apps/plugin-store";
import { toast } from '@/hooks/use-toast';
import { DEFAULT_EXCLUDED_RAG_PATHS } from '@/lib/rag-retrieval-policy';
import {
  DEFAULT_RAG_AGENT_POLICY,
  type RagAgentStrategy,
} from '@/lib/rag-agent-policy';
import type { KnowledgeSourceType } from '@/types/knowledge';

// RAG 设置参数接口
export interface RagSettings {
  // 是否允许 AI 根据问题自动检索笔记
  automaticSearchEnabled: boolean;
  // Agent 自动检索时采用的速度与深度策略
  agentStrategy: RagAgentStrategy;
  // 文本分块的最大字符数
  chunkSize: number;
  // 分块之间的重叠字符数
  chunkOverlap: number;
  // 检索返回的相关文档数量
  resultCount: number;
  // 文档相似度阈值 (0.0-1.0)
  similarityThreshold: number;
  // 重排结果的最低相关性分数
  rerankThreshold: number;
  // 不参与索引和检索的路径前缀
  excludedPaths: string[];
  enabledSourceTypes: KnowledgeSourceType[];
  globalSemanticSearchEnabled: boolean;
  indexPaused: boolean;
}

export type RagPreset = 'precision' | 'balanced' | 'recall';

// 默认参数值
export const DEFAULT_RAG_SETTINGS: RagSettings = {
  automaticSearchEnabled: DEFAULT_RAG_AGENT_POLICY.automaticSearchEnabled,
  agentStrategy: DEFAULT_RAG_AGENT_POLICY.strategy,
  chunkSize: 1000,
  chunkOverlap: 200,
  resultCount: 5,
  similarityThreshold: 0.25,
  rerankThreshold: 0.1,
  excludedPaths: DEFAULT_EXCLUDED_RAG_PATHS,
  enabledSourceTypes: ['article', 'record', 'canvas'],
  globalSemanticSearchEnabled: true,
  indexPaused: false,
};

// RAG 设置状态接口
interface RagSettingsState extends RagSettings {
  indexNeedsRebuild: boolean;
  // 初始化设置
  initSettings: () => Promise<void>;
  // 更新单个设置项
  updateSetting: <K extends keyof RagSettings>(key: K, value: RagSettings[K]) => Promise<void>;
  applyPreset: (preset: RagPreset) => Promise<void>;
  markIndexDirty: () => Promise<void>;
  markIndexClean: () => Promise<void>;
  // 重置所有设置为默认值
  resetToDefaults: () => Promise<void>;
}

// 创建状态存储
const useRagSettingsStore = create<RagSettingsState>((set, get) => ({
  ...DEFAULT_RAG_SETTINGS,
  indexNeedsRebuild: false,

  // 初始化设置
  initSettings: async () => {
    try {
      const store = await Store.load('store.json');
      
      // 从存储中读取各个设置项，如果不存在则使用默认值
      const storedAutomaticSearchEnabled = await store.get<boolean>('ragAutomaticSearchEnabled');
      const legacyRagEnabled = await store.get<boolean>('isRagEnabled');
      const automaticSearchEnabled = storedAutomaticSearchEnabled ?? legacyRagEnabled ?? DEFAULT_RAG_SETTINGS.automaticSearchEnabled;
      const storedAgentStrategy = await store.get<string>('ragAgentStrategy');
      const agentStrategy = storedAgentStrategy === 'fast' || storedAgentStrategy === 'balanced' || storedAgentStrategy === 'deep'
        ? storedAgentStrategy
        : DEFAULT_RAG_SETTINGS.agentStrategy;
      const chunkSize = await store.get<number>('ragChunkSize') ?? DEFAULT_RAG_SETTINGS.chunkSize;
      const chunkOverlap = await store.get<number>('ragChunkOverlap') ?? DEFAULT_RAG_SETTINGS.chunkOverlap;
      const resultCount = await store.get<number>('ragResultCount') ?? DEFAULT_RAG_SETTINGS.resultCount;
      const similarityThreshold = await store.get<number>('ragSimilarityThreshold') ?? DEFAULT_RAG_SETTINGS.similarityThreshold;
      const rerankThreshold = await store.get<number>('ragRerankThreshold') ?? DEFAULT_RAG_SETTINGS.rerankThreshold;
      const excludedPaths = await store.get<string[]>('ragExcludedPaths') ?? DEFAULT_RAG_SETTINGS.excludedPaths;
      const enabledSourceTypes = await store.get<KnowledgeSourceType[]>('ragEnabledSourceTypes') ?? DEFAULT_RAG_SETTINGS.enabledSourceTypes;
      const globalSemanticSearchEnabled = await store.get<boolean>('ragGlobalSemanticSearchEnabled') ?? DEFAULT_RAG_SETTINGS.globalSemanticSearchEnabled;
      const indexPaused = await store.get<boolean>('ragKnowledgeIndexPaused') ?? DEFAULT_RAG_SETTINGS.indexPaused;
      const indexNeedsRebuild = await store.get<boolean>('ragIndexNeedsRebuild') ?? false;
      
      set({
        automaticSearchEnabled,
        agentStrategy,
        chunkSize,
        chunkOverlap,
        resultCount,
        similarityThreshold,
        rerankThreshold,
        excludedPaths,
        enabledSourceTypes,
        globalSemanticSearchEnabled,
        indexPaused,
        indexNeedsRebuild
      });
    } catch (error) {
      console.error('初始化 RAG 设置失败:', error);
    }
  },

  // 更新单个设置项
  updateSetting: async <K extends keyof RagSettings>(key: K, value: RagSettings[K]) => {
    try {
      let resolvedValue = value;
      if (key === 'chunkOverlap') {
        resolvedValue = Math.min(value as number, Math.max(0, get().chunkSize - 50)) as RagSettings[K];
      }
      if (key === 'excludedPaths') {
        resolvedValue = Array.from(new Set(
          (value as string[]).map(path => path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '').trim()).filter(Boolean)
        )) as RagSettings[K];
      }

      // 更新本地状态
      set({ [key]: resolvedValue } as Pick<RagSettings, K>);
      
      // 保存到存储
      const store = await Store.load('store.json');
      const storageKey = key === 'indexPaused'
        ? 'ragKnowledgeIndexPaused'
        : `rag${key.charAt(0).toUpperCase() + key.slice(1)}`;
      await store.set(storageKey, resolvedValue);

      if (key === 'chunkSize' && get().chunkOverlap >= (resolvedValue as number)) {
        const chunkOverlap = Math.max(0, (resolvedValue as number) - 50);
        set({ chunkOverlap });
        await store.set('ragChunkOverlap', chunkOverlap);
      }

      if (
        key === 'chunkSize'
        || key === 'chunkOverlap'
      ) {
        set({ indexNeedsRebuild: true });
        await store.set('ragIndexNeedsRebuild', true);
      }
    } catch (error) {
      console.error(`更新 RAG 设置 ${key} 失败:`, error);
    }
  },

  applyPreset: async (preset) => {
    const presets: Record<RagPreset, Pick<RagSettings, 'resultCount' | 'similarityThreshold' | 'rerankThreshold'>> = {
      precision: { resultCount: 3, similarityThreshold: 0.4, rerankThreshold: 0.25 },
      balanced: { resultCount: 5, similarityThreshold: 0.25, rerankThreshold: 0.1 },
      recall: { resultCount: 8, similarityThreshold: 0.1, rerankThreshold: 0.05 }
    };
    const values = presets[preset];
    const store = await Store.load('store.json');
    set(values);
    await Promise.all([
      store.set('ragResultCount', values.resultCount),
      store.set('ragSimilarityThreshold', values.similarityThreshold),
      store.set('ragRerankThreshold', values.rerankThreshold)
    ]);
  },

  markIndexDirty: async () => {
    set({ indexNeedsRebuild: true });
    const store = await Store.load('store.json');
    await store.set('ragIndexNeedsRebuild', true);
  },

  markIndexClean: async () => {
    set({ indexNeedsRebuild: false });
    const store = await Store.load('store.json');
    await store.set('ragIndexNeedsRebuild', false);
  },

  // 重置所有设置为默认值
  resetToDefaults: async () => {
    try {
      // 更新本地状态
      set({ ...DEFAULT_RAG_SETTINGS, indexNeedsRebuild: true });
      
      // 保存到存储
      const store = await Store.load('store.json');
      await store.set('ragChunkSize', DEFAULT_RAG_SETTINGS.chunkSize);
      await store.set('ragAutomaticSearchEnabled', DEFAULT_RAG_SETTINGS.automaticSearchEnabled);
      await store.set('ragAgentStrategy', DEFAULT_RAG_SETTINGS.agentStrategy);
      await store.set('ragChunkOverlap', DEFAULT_RAG_SETTINGS.chunkOverlap);
      await store.set('ragResultCount', DEFAULT_RAG_SETTINGS.resultCount);
      await store.set('ragSimilarityThreshold', DEFAULT_RAG_SETTINGS.similarityThreshold);
      await store.set('ragRerankThreshold', DEFAULT_RAG_SETTINGS.rerankThreshold);
      await store.set('ragExcludedPaths', DEFAULT_RAG_SETTINGS.excludedPaths);
      await store.set('ragEnabledSourceTypes', DEFAULT_RAG_SETTINGS.enabledSourceTypes);
      await store.set('ragGlobalSemanticSearchEnabled', DEFAULT_RAG_SETTINGS.globalSemanticSearchEnabled);
      await store.set('ragKnowledgeIndexPaused', DEFAULT_RAG_SETTINGS.indexPaused);
      await store.set('ragIndexNeedsRebuild', true);
    } catch (error) {
      toast({
        title: '重置 RAG 设置失败',
        description: error as string,
        variant: 'destructive',
      });
    }
  }
}));

export default useRagSettingsStore;
