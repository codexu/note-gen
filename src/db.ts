import Dexie, { type EntityTable } from 'dexie';

interface Tag {
  id: number;
  name: string;
}

interface Note {
  id: number;
  content: string;
  tagIds: number[];
}

const db = new Dexie('note-db') as Dexie & {
  tags: EntityTable<Tag, 'id'>;
  notes: EntityTable<Note, 'id'>;
};

db.version(1).stores({
  tags: '++id, name&',
  notes: '++id, content, tagIds'
});

export type { Tag, Note };
export { db };