import { create } from 'zustand';
import { initVectorDb, processAllMarkdownFiles, processMarkdownFile, checkEmbeddingModelAvailable } from '@/lib/rag';
import { checkRerankModelAvailable } from '@/lib/ai';
import { Store } from "@tauri-apps/plugin-store";
import { toast } from '@/hooks/use-toast';

interface VectorState {
  // 向量数据库状态
  isVectorDbEnabled: boolean;      // 是否启用向量数据库
  isRagEnabled: boolean;           // 是否启用RAG检索功能
  isProcessing: boolean;           // 是否正在处理向量
  lastProcessTime: number | null;  // 最后一次处理向量的时间
  hasRerankModel: boolean;         // 是否有可用的重排序模型
  
  // 统计数据
  documentCount: number;           // 文档数量
  
  // 初始化函数
  initVectorDb: () => Promise<void>;
  
  // 向量数据库启用/禁用
  setVectorDbEnabled: (enabled: boolean) => Promise<void>;
  setRagEnabled: (enabled: boolean) => Promise<void>;
  
  // 处理向量
  processAllDocuments: () => Promise<void>;
  processDocument: (filename: string, content: string) => Promise<void>;
  checkEmbeddingModel: () => Promise<boolean>;
  checkRerankModel: () => Promise<boolean>;
}

const useVectorStore = create<VectorState>((set, get) => ({
  isVectorDbEnabled: false,
  isRagEnabled: false,
  isProcessing: false,
  lastProcessTime: null,
  hasRerankModel: false,
  documentCount: 0,
  
  // 初始化向量数据库
  initVectorDb: async () => {
    try {
      await initVectorDb();
      
      // 读取用户设置
      const store = await Store.load('store.json');
      const isVectorDbEnabled = await store.get<boolean>('isVectorDbEnabled') || false;
      const isRagEnabled = await store.get<boolean>('isRagEnabled') || false;
      const lastProcessTime = await store.get<number>('lastVectorProcessTime') || null;
      
      set({ 
        isVectorDbEnabled, 
        isRagEnabled,
        lastProcessTime
      });
      
      // 如果已启用向量数据库且有嵌入模型，检查模型可用性
      if (isVectorDbEnabled) {
        const modelAvailable = await get().checkEmbeddingModel();
        if (!modelAvailable) {
          // 如果模型不可用，禁用向量数据库和RAG
          await get().setVectorDbEnabled(false);
          await get().setRagEnabled(false);
        }
      }
      
      // 检查重排序模型是否可用
      const hasRerankModel = await get().checkRerankModel();
      set({ hasRerankModel });
    } catch (error) {
      console.error('初始化向量数据库失败:', error);
    }
  },
  
  // 设置向量数据库启用状态
  setVectorDbEnabled: async (enabled: boolean) => {
    try {
      const store = await Store.load('store.json');
      await store.set('isVectorDbEnabled', enabled);
      
      set({ isVectorDbEnabled: enabled });
      
      // 如果启用向量数据库，检查嵌入模型是否可用
      if (enabled) {
        const modelAvailable = await get().checkEmbeddingModel();
        if (!modelAvailable) {
          toast({
            title: '向量数据库',
            description: '未配置嵌入模型或模型不可用，请在AI设置中配置嵌入模型',
            variant: 'destructive',
          });
          
          // 自动禁用
          await store.set('isVectorDbEnabled', false);
          set({ isVectorDbEnabled: false });
        }
      }
    } catch (error) {
      console.error('设置向量数据库状态失败:', error);
    }
  },
  
  // 设置RAG启用状态
  setRagEnabled: async (enabled: boolean) => {
    try {
      const store = await Store.load('store.json');
      await store.set('isRagEnabled', enabled);
      
      set({ isRagEnabled: enabled });
      
      // 如果启用RAG但向量数据库未启用，自动启用向量数据库
      if (enabled && !get().isVectorDbEnabled) {
        await get().setVectorDbEnabled(true);
      }
    } catch (error) {
      console.error('设置RAG状态失败:', error);
    }
  },
  
  // 处理所有文档向量
  processAllDocuments: async () => {
    // 如果已经在处理中，直接返回
    if (get().isProcessing) return;
    
    try {
      // 检查嵌入模型是否可用
      const modelAvailable = await get().checkEmbeddingModel();
      if (!modelAvailable) {
        toast({
          title: '向量处理',
          description: '未配置嵌入模型或模型不可用，请在AI设置中配置嵌入模型',
          variant: 'destructive',
        });
        return;
      }
      
      // 设置处理状态
      set({ isProcessing: true });
      
      // 显示处理开始的提示
      toast({
        title: '向量处理',
        description: '开始处理文档向量，这可能需要一些时间...',
      });
      
      // 处理所有文档
      const result = await processAllMarkdownFiles();
      
      // 更新处理时间和状态
      const currentTime = Date.now();
      const store = await Store.load('store.json');
      await store.set('lastVectorProcessTime', currentTime);
      
      set({ 
        isProcessing: false,
        lastProcessTime: currentTime,
        documentCount: result.success
      });
      
      // 显示处理结果
      toast({
        title: '向量处理完成',
        description: `成功处理 ${result.success} 个文档，失败 ${result.failed} 个文档。`,
      });
    } catch (error) {
      console.error('处理文档向量失败:', error);
      set({ isProcessing: false });
      
      toast({
        title: '向量处理失败',
        description: '处理文档向量时发生错误，请查看控制台日志',
        variant: 'destructive',
      });
    }
  },
  
  // 处理单个文档向量
  processDocument: async (filename: string, content: string) => {
    // 如果向量数据库未启用，直接返回
    if (!get().isVectorDbEnabled) return;
    
    try {
      await processMarkdownFile(filename, content);
    } catch (error) {
      console.error(`处理文档 ${filename} 向量失败:`, error);
    }
  },
  
  // 检查嵌入模型可用性
  checkEmbeddingModel: async () => {
    try {
      const modelAvailable = await checkEmbeddingModelAvailable();
      return modelAvailable;
    } catch (error) {
      console.error('检查嵌入模型失败:', error);
      return false;
    }
  },
  
  // 检查重排序模型可用性
  checkRerankModel: async () => {
    try {
      const modelAvailable = await checkRerankModelAvailable();
      set({ hasRerankModel: modelAvailable });
      return modelAvailable;
    } catch (error) {
      console.error('检查重排序模型失败:', error);
      set({ hasRerankModel: false });
      return false;
    }
  }
}));

export default useVectorStore;
