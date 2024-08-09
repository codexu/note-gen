import Dexie, { type EntityTable } from 'dexie';

interface Tag {
  id: number;
  name: string;
}

interface Mark {
  id: number;
  imgPath: string;
  content: string;
  tag: string;
  keywords: string[];
  createdAt: number;
}

interface Note {
  id: number;
  title: string;
  content: string;
  markIds: number[];
  tag: string;
  createdAt: number;
}

const db = new Dexie('note-db') as Dexie & {
  tags: EntityTable<Tag, 'id'>;
  marks: EntityTable<Mark, 'id'>;
  notes: EntityTable<Note, 'id'>;
};

db.version(1).stores({
  tags: '++id, name&',
  marks: '++id, imgPath, content, tag, keywords, createdAt',
  notes: '++id, title, content, markIds, tag, createdAt'
});

export type { Tag, Mark, Note };
export { db };