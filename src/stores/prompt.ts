import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'

export interface Prompt {
  id: string
  title: string
  content: string
  isDefault?: boolean
}

interface PromptState {
  promptList: Prompt[]
  currentPrompt: Prompt | null
  
  initPromptData: () => Promise<void>
  setPromptList: (promptList: Prompt[]) => Promise<void>
  addPrompt: (prompt: Omit<Prompt, 'id'>) => Promise<void>
  updatePrompt: (prompt: Prompt) => Promise<void>
  deletePrompt: (id: string) => Promise<void>
  setCurrentPrompt: (prompt: Prompt | null) => Promise<void>
}

const usePromptStore = create<PromptState>((set, get) => ({
  promptList: [
    {
      id: '0',
      title: '写作助手',
      content: '请你扮演一个笔记软件的智能助手，可以参考记录内容，使用 markdown 语法，回答用户的问题。',
      isDefault: true
    }
  ],
  currentPrompt: null,
  
  initPromptData: async () => {
    const store = await Store.load('store.json');
    const promptList = await store.get<Prompt[]>('promptList');
    if (promptList) {
      set({ promptList });
    } else {
      // 如果不存在，设置默认
      const defaultPromptList = get().promptList;
      await store.set('promptList', defaultPromptList);
    }
    
    // 设置当前使用的prompt
    const currentPromptId = await store.get<string>('currentPromptId');
    if (currentPromptId) {
      const prompt = get().promptList.find(item => item.id === currentPromptId);
      if (prompt) {
        set({ currentPrompt: prompt });
      }
    } else {
      // 默认使用第一个prompt
      const defaultPrompt = get().promptList[0];
      set({ currentPrompt: defaultPrompt });
      await store.set('currentPromptId', defaultPrompt.id);
    }
  },
  
  setPromptList: async (promptList) => {
    set({ promptList });
    const store = await Store.load('store.json');
    await store.set('promptList', promptList);
  },
  
  addPrompt: async (promptData) => {
    const prompt: Prompt = {
      id: Date.now().toString(),
      ...promptData
    };
    
    const promptList = [...get().promptList, prompt];
    await get().setPromptList(promptList);
  },
  
  updatePrompt: async (updatedPrompt) => {
    const promptList = get().promptList.map(prompt => 
      prompt.id === updatedPrompt.id ? updatedPrompt : prompt
    );
    
    await get().setPromptList(promptList);
    
    // 如果更新的是当前选中的prompt，同时更新currentPrompt
    const currentPrompt = get().currentPrompt;
    if (currentPrompt && currentPrompt.id === updatedPrompt.id) {
      set({ currentPrompt: updatedPrompt });
    }
  },
  
  deletePrompt: async (id) => {
    // 不允许删除默认prompt
    const promptToDelete = get().promptList.find(prompt => prompt.id === id);
    if (promptToDelete?.isDefault) return;
    
    const promptList = get().promptList.filter(prompt => prompt.id !== id);
    await get().setPromptList(promptList);
    
    // 如果删除的是当前选中的prompt，将当前prompt设置为默认prompt
    const currentPrompt = get().currentPrompt;
    if (currentPrompt && currentPrompt.id === id) {
      const defaultPrompt = get().promptList.find(prompt => prompt.isDefault);
      if (defaultPrompt) {
        await get().setCurrentPrompt(defaultPrompt);
      }
    }
  },
  
  setCurrentPrompt: async (prompt) => {
    set({ currentPrompt: prompt });
    if (prompt) {
      const store = await Store.load('store.json');
      await store.set('currentPromptId', prompt.id);
    }
  }
}));

export default usePromptStore;
