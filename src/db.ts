import Dexie, { type EntityTable } from 'dexie';

interface Tag {
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
  tag: number;
  keywords: string[];
  createdAt: number;
}

interface Note {
  id: number;
  title: string;
  content: string;
  markIds: number[];
  tag: number;
  createdAt: number;
}

const db = new Dexie('note-db') as Dexie & {
  tags: EntityTable<Tag, 'id'>;
  marks: EntityTable<Mark, 'id'>;
  notes: EntityTable<Note, 'id'>;
};

db.version(1).stores({
  tags: '++id, name&, total, createdAt',
  marks: '++id, status, imgPath, content, description, tag, keywords, createdAt',
  notes: '++id, title, content, markIds, tag, createdAt'
});

export type { Tag, Mark, Note };
export { db };