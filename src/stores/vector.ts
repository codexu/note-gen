import { create } from 'zustand';
import { initVectorDb, processAllMarkdownFiles, processMarkdownFile, checkEmbeddingModelAvailable } from '@/lib/rag';
import { checkRerankModelAvailable } from '@/lib/ai';
import { toast } from '@/hooks/use-toast';

// Check if we're in Tauri environment
const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__;

interface VectorState {
  // Vector database status
  isVectorDbEnabled: boolean;      // Whether vector database is enabled
  isRagEnabled: boolean;           // Whether RAG retrieval function is enabled
  isProcessing: boolean;           // Whether currently processing vectors
  lastProcessTime: number | null;  // Last time vectors were processed
  hasRerankModel: boolean;         // Whether reranking model is available
  
  // Statistics
  documentCount: number;           // Document count
  
  // Initialization function
  initVectorDb: () => Promise<void>;
  
  // Vector database enable/disable
  setVectorDbEnabled: (enabled: boolean) => Promise<void>;
  setRagEnabled: (enabled: boolean) => Promise<void>;
  
  // Process vectors
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
  
  // Initialize vector database
  initVectorDb: async () => {
    if (!isTauri) {
      console.log('Vector database not available in browser mode');
      return;
    }

    try {
      await initVectorDb();
      
      // Read user settings
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('store.json');
      const isVectorDbEnabled = await store.get<boolean>('isVectorDbEnabled') || false;
      const isRagEnabled = await store.get<boolean>('isRagEnabled') || false;
      const lastProcessTime = await store.get<number>('lastVectorProcessTime') || null;
      
      set({ 
        isVectorDbEnabled, 
        isRagEnabled,
        lastProcessTime
      });
      
      // If vector database is enabled and has embedding model, check model availability
      if (isVectorDbEnabled) {
        const modelAvailable = await get().checkEmbeddingModel();
        if (!modelAvailable) {
          // If model is not available, disable vector database and RAG
          await get().setVectorDbEnabled(false);
          await get().setRagEnabled(false);
        }
      }
      
      // Check if reranking model is available
      const hasRerankModel = await get().checkRerankModel();
      set({ hasRerankModel });
    } catch (error) {
      console.error('Failed to initialize vector database:', error);
    }
  },
  
  // Set vector database enabled status
  setVectorDbEnabled: async (enabled: boolean) => {
    if (!isTauri) {
      console.log('Vector database settings not available in browser mode');
      return;
    }

    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('store.json');
      await store.set('isVectorDbEnabled', enabled);
      
      set({ isVectorDbEnabled: enabled });
      
      // If enabling vector database, check if embedding model is available
      if (enabled) {
        const modelAvailable = await get().checkEmbeddingModel();
        if (!modelAvailable) {
          toast({
            title: 'Vector Database',
            description: 'No embedding model configured or model unavailable. Please configure embedding model in AI settings.',
            variant: 'destructive',
          });
          
          // Auto disable
          await store.set('isVectorDbEnabled', false);
          set({ isVectorDbEnabled: false });
        }
      }
    } catch (error) {
      console.error('Failed to set vector database status:', error);
    }
  },
  
  // Set RAG enabled status
  setRagEnabled: async (enabled: boolean) => {
    if (!isTauri) {
      console.log('RAG settings not available in browser mode');
      return;
    }

    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('store.json');
      await store.set('isRagEnabled', enabled);
      
      set({ isRagEnabled: enabled });
      
      // If enabling RAG but vector database is not enabled, auto enable vector database
      if (enabled && !get().isVectorDbEnabled) {
        await get().setVectorDbEnabled(true);
      }
    } catch (error) {
      console.error('Failed to set RAG status:', error);
    }
  },
  
  // Process all document vectors
  processAllDocuments: async () => {
    if (!isTauri) {
      console.log('Document processing not available in browser mode');
      return;
    }

    // If already processing, return directly
    if (get().isProcessing) return;
    
    try {
      // Check if embedding model is available
      const modelAvailable = await get().checkEmbeddingModel();
      if (!modelAvailable) {
        toast({
          title: 'Vector Processing',
          description: 'No embedding model configured or model unavailable. Please configure embedding model in AI settings.',
          variant: 'destructive',
        });
        return;
      }
      
      // Set processing status
      set({ isProcessing: true });
      
      // Show processing start notification
      toast({
        title: 'Vector Processing',
        description: 'Starting to process document vectors, this may take some time...',
      });
      
      // Process all documents
      const result = await processAllMarkdownFiles();
      
      // Update processing time and status
      const currentTime = Date.now();
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('store.json');
      await store.set('lastVectorProcessTime', currentTime);
      
      set({ 
        isProcessing: false,
        lastProcessTime: currentTime,
        documentCount: result.success
      });
      
      // Show processing result
      toast({
        title: 'Vector Processing Complete',
        description: `Successfully processed ${result.success} documents, failed ${result.failed} documents.`,
      });
    } catch (error) {
      console.error('Failed to process document vectors:', error);
      set({ isProcessing: false });
      
      toast({
        title: 'Vector Processing Failed',
        description: 'Error occurred while processing document vectors, please check console logs',
        variant: 'destructive',
      });
    }
  },
  
  // Process single document vector
  processDocument: async (filename: string, content: string) => {
    if (!isTauri) {
      return;
    }

    // If vector database is not enabled, return directly
    if (!get().isVectorDbEnabled) return;
    
    try {
      await processMarkdownFile(filename, content);
    } catch (error) {
      console.error(`Failed to process document ${filename} vector:`, error);
    }
  },
  
  // Check embedding model availability
  checkEmbeddingModel: async () => {
    if (!isTauri) {
      return false;
    }

    try {
      const modelAvailable = await checkEmbeddingModelAvailable();
      return modelAvailable;
    } catch (error) {
      console.error('Failed to check embedding model:', error);
      return false;
    }
  },
  
  // Check reranking model availability
  checkRerankModel: async () => {
    if (!isTauri) {
      return false;
    }

    try {
      const modelAvailable = await checkRerankModelAvailable();
      set({ hasRerankModel: modelAvailable });
      return modelAvailable;
    } catch (error) {
      console.error('Failed to check reranking model:', error);
      set({ hasRerankModel: false });
      return false;
    }
  }
}));

export default useVectorStore;
