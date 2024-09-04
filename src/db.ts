import Dexie, { type EntityTable } from 'dexie';

interface Tab {
  id: number;
  name: string;
  total?: number;
  createdAt: number;
}

interface Mark {
  id: number;
  status: boolean;
  imgPath: string;
  content: string;
  description: string;
  tab: number;
  keywords: string[];
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

interface Article {
  id: number;
  title: string;
  content: string;
  file: string;
  markIds: number[];
  keywords: string[];
  description: string;
  createdAt: number;
  updatedAt: number;
}

const db = new Dexie('note-db') as Dexie & {
  tabs: EntityTable<Tab, 'id'>;
  marks: EntityTable<Mark, 'id'>;
  notes: EntityTable<Note, 'id'>;
  articles: EntityTable<Article, 'id'>
};

db.version(1).stores({
  tabs: '++id, name&, total, createdAt',
  marks: '++id, status, imgPath, content, description, tab, keywords, createdAt',
  notes: '++id, title, content, markIds, tab, generating, createdAt',
  articles: '++id, title, content, file, markIds, keywords, description, createdAt, updatedAt'
});

export type { Tab, Mark, Note };
export { db };