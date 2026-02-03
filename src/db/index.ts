
import Database from '@tauri-apps/plugin-sql';

// 导出数据库实例
export const db = await Database.load('sqlite:note.db');

// 获取数据库实例(兼容旧代码)
export async function getDb() {
  return db;
}

// 数据库初始化状态
let dbInitialized = false;
let dbInitPromise: Promise<void> | null = null;

// 检查数据库是否已初始化
export function isDbInitialized() {
  return dbInitialized;
}

// 等待数据库初始化完成
export async function waitForDbInit() {
  if (dbInitialized) return;
  if (dbInitPromise) {
    await dbInitPromise;
    return;
  }
  // 如果还没开始初始化，等待一小段时间后重试
  await new Promise(resolve => setTimeout(resolve, 100));
  return waitForDbInit();
}

// 初始化所有数据库
export async function initAllDatabases() {
  if (dbInitialized) return;
  if (dbInitPromise) return dbInitPromise;
  
  dbInitPromise = (async () => {
    try {
      // 引入各数据库初始化函数
      const { initChatsDb } = await import('./chats');
      const { initMarksDb } = await import('./marks');
      const { initNotesDb } = await import('./notes');
      const { initTagsDb } = await import('./tags');
      const { initVectorDb } = await import('./vector');
      const { initTavernDb } = await import('./tavern');
      
      // 执行初始化
      await initChatsDb();
      await initMarksDb();
      await initNotesDb();
      await initTagsDb();
      await initVectorDb();
      await initTavernDb();
      
      dbInitialized = true;
      console.log('All databases initialized successfully');
    } catch (error) {
      console.error('Failed to initialize databases:', error);
      dbInitPromise = null; // 允许重试
      throw error;
    }
  })();
  
  return dbInitPromise;
}
