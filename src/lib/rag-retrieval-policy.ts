import { getIdentifierTerms } from './lexical-tokenizer';

export interface RetrievalWeights {
  fuzzyWeight: number;
  vectorWeight: number;
  bm25Weight: number;
}

export interface RetrievalScope {
  includedPaths?: readonly string[];
  excludedPaths?: readonly string[];
}

export interface RetrievalStrategy {
  kind: 'exact' | 'short' | 'multi-constraint' | 'semantic';
  weights: RetrievalWeights;
  vectorCandidateMultiplier: number;
  lexicalCandidateMultiplier: number;
  fuzzyThreshold: number;
  rerankThreshold: number;
}

export const DEFAULT_EXCLUDED_RAG_PATHS = ['.git', '.trash', 'node_modules', 'skills'];

export function normalizeRagPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '').trim();
}

function matchesPathPrefix(path: string, prefix: string): boolean {
  const normalizedPath = normalizeRagPath(path).toLocaleLowerCase();
  const normalizedPrefix = normalizeRagPath(prefix).toLocaleLowerCase();
  if (!normalizedPrefix) return false;
  return normalizedPath === normalizedPrefix
    || normalizedPath.startsWith(`${normalizedPrefix}/`)
    || normalizedPath.includes(`/${normalizedPrefix}/`)
    || normalizedPath.endsWith(`/${normalizedPrefix}`)
    || normalizedPath.split('/').includes(normalizedPrefix);
}

export function isPathAllowedForRag(path: string, scope: RetrievalScope = {}): boolean {
  const normalizedPath = normalizeRagPath(path);
  const excludedPaths = scope.excludedPaths || [];
  if (excludedPaths.some(prefix => matchesPathPrefix(normalizedPath, prefix))) {
    return false;
  }

  const includedPaths = (scope.includedPaths || []).filter(Boolean);
  return includedPaths.length === 0
    || includedPaths.some(prefix => matchesPathPrefix(normalizedPath, prefix));
}

export function getRagDisplayFilename(path: string): string {
  const normalizedPath = normalizeRagPath(path);
  return normalizedPath.split('/').pop() || normalizedPath;
}

function hasExactIdentifier(query: string): boolean {
  return getIdentifierTerms(query).some(term => (
    /[._/+#]/u.test(term)
    || (/\p{L}/u.test(term) && /\p{N}/u.test(term))
    || /^[\p{N}]{2,}$/u.test(term)
    || /\p{N}-\p{N}/u.test(term)
  ));
}

function isShortQuery(query: string): boolean {
  const compact = query.replace(/[\p{P}\p{S}\s]/gu, '');
  const words = query.trim().split(/\s+/).filter(Boolean);
  const containsUnsegmentedScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(query);
  return containsUnsegmentedScript ? compact.length <= 6 : words.length <= 2;
}

function hasMultipleConstraints(query: string): boolean {
  const markers = query.match(/同时|并且|而且|必须|不能|不得|以及|且|\band\b|\bwith\b|\bwithout\b|\bmust\b|\bnot\b/gi);
  return (markers?.length || 0) >= 2 || /[；;].+[；;]/.test(query);
}

export function createRetrievalStrategy(
  query: string,
  baseWeights: RetrievalWeights,
  baseRerankThreshold: number
): RetrievalStrategy {
  if (hasExactIdentifier(query)) {
    return {
      kind: 'exact',
      weights: {
        fuzzyWeight: 0.15,
        vectorWeight: 0.25,
        bm25Weight: 0.6
      },
      vectorCandidateMultiplier: 3,
      lexicalCandidateMultiplier: 6,
      fuzzyThreshold: 0.2,
      rerankThreshold: Math.max(baseRerankThreshold, 0.15)
    };
  }

  if (hasMultipleConstraints(query)) {
    return {
      kind: 'multi-constraint',
      weights: {
        fuzzyWeight: 0.15,
        vectorWeight: 0.6,
        bm25Weight: 0.25
      },
      vectorCandidateMultiplier: 6,
      lexicalCandidateMultiplier: 6,
      fuzzyThreshold: 0.3,
      rerankThreshold: baseRerankThreshold
    };
  }

  if (isShortQuery(query)) {
    return {
      kind: 'short',
      weights: {
        fuzzyWeight: 0.35,
        vectorWeight: 0.4,
        bm25Weight: 0.25
      },
      vectorCandidateMultiplier: 3,
      lexicalCandidateMultiplier: 4,
      fuzzyThreshold: 0.25,
      rerankThreshold: baseRerankThreshold
    };
  }

  return {
    kind: 'semantic',
    weights: baseWeights,
    vectorCandidateMultiplier: 4,
    lexicalCandidateMultiplier: 4,
    fuzzyThreshold: 0.3,
    rerankThreshold: baseRerankThreshold
  };
}
