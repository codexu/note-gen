import {
  getDiskBM25Stats, readBM25Catalog, removeBM25Sources, replaceBM25Source,
  resetBM25Workspace, searchDiskBM25, type DiskBM25Hit,
} from './bm25-disk';
import { captureWikiWorkspaceGuard, getWikiContext } from './wiki/context';
import { isAbsoluteFsPath, toWorkspaceRelativePath } from './workspace';
import { createKnowledgeSourceKey, parseKnowledgeSourceKey } from '@/types/knowledge';

export interface WorkspaceBM25Index {
  search(query: string, limit: number, allowedSourceKeys?: ReadonlySet<string>): Promise<DiskBM25Hit[]>;
}

interface WorkspaceSession {
  workspace: Promise<string>;
  isCurrent: () => boolean;
  revision: number;
  ready: boolean;
  rebuild: boolean;
  cleared: boolean;
  clears: number;
  changedSources: Set<string>;
  availableSources?: Set<string>;
  pending?: Promise<WorkspaceBM25Index | null>;
  clearing?: Promise<void>;
}

let active: WorkspaceSession | undefined;

function session(): WorkspaceSession {
  if (active?.isCurrent()) return active;
  const guard = captureWikiWorkspaceGuard();
  const next: WorkspaceSession = {
    workspace: getWikiContext().then(context => context.id).catch(error => {
      if (active === next) active = undefined;
      throw error;
    }),
    isCurrent: () => active === next && guard(),
    revision: 0, ready: false, rebuild: false, cleared: false, clears: 0, changedSources: new Set(),
  };
  active = next;
  return next;
}

export function invalidateWorkspaceBM25(sourceKey?: string): void {
  if (!active?.isCurrent()) return;
  active.revision++;
  active.ready = false;
  if (sourceKey) active.changedSources.add(sourceKey);
}

function matchesSource(key: string, changes: ReadonlySet<string>): boolean {
  if (changes.has(key)) return true;
  if (key.startsWith('article:') && changes.has('article:')) return true;
  // Directory renames and deletes can affect every descendant.
  for (let slash = key.lastIndexOf('/'); slash >= 0; slash = key.lastIndexOf('/', slash - 1)) {
    if (changes.has(key.slice(0, slash))) return true;
    if (slash === 0) break;
  }
  return false;
}

async function canonicalChanges(changes: ReadonlySet<string>) {
  const result = new Set<string>();
  for (const key of changes) {
    const source = parseKnowledgeSourceKey(key);
    if (source && source.sourceType !== 'article') {
      result.add(key);
    } else {
      const path = (source?.sourceId ?? key).replaceAll('\\', '/');
      result.add(createKnowledgeSourceKey('article', isAbsoluteFsPath(path) ? await toWorkspaceRelativePath(path) : path));
    }
  }
  return result;
}

async function reconcile(state: WorkspaceSession, workspace: string): Promise<void> {
  const { getBM25Sources, BM25SourceUnavailableError, BM25SourceChangedError } = await import('./bm25-sources');
  let previousAttempt: { revision: number; generation: number } | undefined;
  const retriedSources = new Set<string>();
  while (state.isCurrent() && !state.ready) {
    if (state.clearing) await state.clearing;
    if (state.ready || !state.isCurrent()) return;
    const revision = state.revision;
    const isCurrent = () => state.isCurrent() && state.revision === revision;
    try {
      const catalog = await readBM25Catalog(workspace);
      if (!isCurrent()) continue;
      // A different window cleared this workspace while our write was in flight.
      if (previousAttempt?.revision === revision && previousAttempt.generation !== catalog.generation) {
        state.clears++;
        state.cleared = true;
        state.rebuild = false;
        state.ready = true;
        state.changedSources.clear();
        state.availableSources = undefined;
        return;
      }
      previousAttempt = { revision, generation: catalog.generation };
      const { sources, unreadable } = await getBM25Sources(isCurrent);
      const changes = await canonicalChanges(state.changedSources);
      let conflict = false;
      for (const [key, source] of sources) {
        if (!isCurrent()) break;
        const previous = catalog.sources.get(key) ?? null;
        catalog.sources.delete(key);
        const touched = matchesSource(key, changes);
        if ((state.cleared && !touched) || (!state.rebuild && !touched && previous === source.signature)) continue;

        let chunks: string[];
        try {
          chunks = await source.readChunks();
        } catch (error) {
          if (error instanceof BM25SourceChangedError) {
            if (!retriedSources.has(key)) {
              retriedSources.add(key);
              conflict = true;
              break;
            }
          } else if (!(error instanceof BM25SourceUnavailableError)) throw error;
          unreadable.add(key);
          continue;
        }
        if (!isCurrent()) break;
        if (!await replaceBM25Source(workspace, catalog.generation, key, source.signature, chunks, previous)) {
          conflict = true;
          break;
        }
      }
      if (!isCurrent() || conflict) continue;
      for (const key of catalog.sources.keys()) {
        if (matchesSource(key, unreadable)) catalog.sources.delete(key);
      }
      if (!await removeBM25Sources(workspace, catalog.generation, catalog.sources)) continue;
      if (isCurrent()) {
        state.ready = true;
        state.rebuild = false;
        state.changedSources.clear();
        for (const key of changes) {
          if (matchesSource(key, unreadable)) state.changedSources.add(key);
        }
        for (const key of unreadable) {
          if (matchesSource(key, changes)) state.changedSources.add(key);
        }
        state.availableSources = unreadable.size
          ? new Set(Array.from(sources.keys()).filter(key => !matchesSource(key, unreadable)))
          : undefined;
      }
    } catch (error) {
      if (isCurrent()) throw error;
    }
  }
}

async function prepare(state: WorkspaceSession): Promise<WorkspaceBM25Index | null> {
  const workspace = await state.workspace;
  if (state.clearing) await state.clearing;
  if (!state.ready) await reconcile(state, workspace);
  if (!state.isCurrent()) return null;
  return {
    async search(query, limit, allowedSourceKeys) {
      while (state.isCurrent()) {
        if (!state.ready) {
          if (!await ensureWorkspaceBM25Index()) return [];
          continue;
        }
        const revision = state.revision;
        // A temporarily unreadable source keeps its disk cache, but cannot contribute old text.
        const available = state.availableSources;
        const scope = available && allowedSourceKeys
          ? new Set(Array.from(allowedSourceKeys).filter(key => available.has(key)))
          : available ?? allowedSourceKeys;
        const hits = await searchDiskBM25(workspace, query, limit, scope);
        if (state.isCurrent() && revision === state.revision) return hits;
      }
      return [];
    },
  };
}

export function ensureWorkspaceBM25Index({ rebuild = false } = {}): Promise<WorkspaceBM25Index | null> {
  const state = session();
  if (state.availableSources && !state.pending) state.ready = false;
  if (rebuild && !state.rebuild) {
    state.rebuild = true;
    state.cleared = false;
    invalidateWorkspaceBM25();
  }
  const clears = state.clears;
  state.pending ??= prepare(state).finally(() => { state.pending = undefined; });
  return rebuild
    ? state.pending.then(index => state.clears === clears ? index : null)
    : state.pending;
}

export async function clearWorkspaceBM25Index(): Promise<void> {
  const state = session();
  if (state.clearing) return state.clearing;
  state.revision++;
  state.clears++;
  state.ready = false;
  state.rebuild = false;
  state.cleared = true;
  state.changedSources.clear();
  state.availableSources = undefined;
  const revision = state.revision;
  state.clearing = state.workspace.then(async workspace => {
    if (state.isCurrent()) await resetBM25Workspace(workspace);
    if (state.revision === revision) state.ready = true;
  }).catch(error => {
    state.cleared = false;
    throw error;
  }).finally(() => { state.clearing = undefined; });
  await state.clearing;
}

export async function getWorkspaceBM25Stats() {
  const state = session();
  if (state.clearing) await state.clearing;
  const stats = await getDiskBM25Stats(await state.workspace);
  return state.isCurrent() ? stats : { documentCount: 0, chunkCount: 0 };
}
