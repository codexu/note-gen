import Dexie, { type EntityTable } from 'dexie';

interface Tab {
  id: number;
  name: string;
  total?: number;
  createdAt: number;
}

interface Mark {
  id: number;
  type: 'screenshot' | 'text' | 'image'
  status: boolean;
  imgPath: string;
  content: string;
  description: string;
  tab: number;
  keywords: string[];
  deleted: boolean;
  deletedAt?: number;
  createdAt: number;
}

interface Note {
  id: number;
  title: string;
  content: string;
  markIds: number[];
  tab: number;
  generating: boolean;
  createdAt: number;
}

const db = new Dexie('note-db') as Dexie & {
  tabs: EntityTable<Tab, 'id'>;
  marks: EntityTable<Mark, 'id'>;
  notes: EntityTable<Note, 'id'>;
};

db.version(1).stores({
  tabs: '++id, name&, total, createdAt',
  marks: '++id, type, status, imgPath, content, description, tab, keywords, deleted, deletedAt, createdAt',
  notes: '++id, title, content, markIds, tab, generating, createdAt',
  folders: '++id, name, createdAt',
});

export type { Tab, Mark, Note };
export { db };