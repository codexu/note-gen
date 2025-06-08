// Database module with browser compatibility

let db: any = null;

// Check if we're in Tauri environment
const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__;

// Export database instance
if (isTauri) {
  try {
    const Database = await import('@tauri-apps/plugin-sql');
    db = await Database.default.load('sqlite:note.db');
  } catch (error) {
    console.log('Failed to load Tauri database:', error);
    db = null;
  }
} else {
  console.log('Running in browser mode - database not available');
  db = null;
}

export { db };

// Get database instance (compatibility with legacy code)
export async function getDb() {
  if (!isTauri) {
    console.log('Database not available in browser mode');
    return null;
  }
  return db;
}

// Initialize all databases
export async function initAllDatabases() {
  if (!isTauri) {
    console.log('Skipping database initialization in browser mode');
    return;
  }

  try {
    // Import database initialization functions
    const { initChatsDb } = await import('./chats');
    const { initMarksDb } = await import('./marks');
    const { initNotesDb } = await import('./notes');
    const { initTagsDb } = await import('./tags');
    const { initVectorDb } = await import('./vector');
    
    // Execute initialization
    await initChatsDb();
    await initMarksDb();
    await initNotesDb();
    await initTagsDb();
    await initVectorDb();
  } catch (error) {
    console.log('Database initialization failed:', error);
  }
}
