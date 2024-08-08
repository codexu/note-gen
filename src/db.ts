import Dexie, { type EntityTable } from 'dexie';

interface Tag {
  id: number;
  name: string;
}

interface Note {
  id: number;
  imgPath: string;
  content: string;
  tag: number;
}

const db = new Dexie('note-db') as Dexie & {
  tags: EntityTable<Tag, 'id'>;
  notes: EntityTable<Note, 'id'>;
};

db.version(1).stores({
  tags: '++id, name&',
  notes: '++id, imgPath, content, tag'
});

export type { Tag, Note };
export { db };