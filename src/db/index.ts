
import Database from '@tauri-apps/plugin-sql';

let dbPromise: Promise<Database> | null = null;

// 获取数据库实例(兼容旧代码)
export async function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load('sqlite:note.db');
  }

  return dbPromise;
}

// 初始化所有数据库
export async function initAllDatabases() {
  // 引入各数据库初始化函数
  const { initChatsDb } = await import('./chats');
  const { initMarksDb } = await import('./marks');
  const { initNotesDb } = await import('./notes');
  const { initTagsDb } = await import('./tags');
  const { initVectorDb } = await import('./vector');
  const { initConversationsDb } = await import('./conversations');
  const { initMemoriesDb } = await import('./memories');
  const { initActivityDb } = await import('./activity');

  // 执行初始化：先确保基础表存在，再做 conversations 对 chats 的迁移/补列。
  await initChatsDb();
  await initConversationsDb();
  await initMarksDb();
  await initNotesDb();
  await initTagsDb();
  await initVectorDb();
  await initMemoriesDb();
  await initActivityDb();
}
