export interface ClassifiedSkillScriptPath {
  kind: 'generated-runtime-script' | 'runtime-script' | 'builtin-skill-script' | 'other'
  normalizedArg: string
}

function hasScriptExtension(filePath: string): boolean {
  return /\.(py|js|mjs|cjs|sh|bash)$/i.test(filePath)
}

export function classifySkillScriptPath(arg: string): ClassifiedSkillScriptPath {
  const normalized = arg.replace(/\\/g, '/')

  const runtimeMatch = normalized.match(/^skills\/[^/]+\/scripts\/[^/]+\/([^/]+)$/)
  if (runtimeMatch) {
    return {
      kind: 'generated-runtime-script',
      normalizedArg: runtimeMatch[1],
    }
  }

  if (normalized.startsWith('scripts/')) {
    return {
      kind: 'builtin-skill-script',
      normalizedArg: normalized,
    }
  }

  if (!normalized.includes('/') && hasScriptExtension(normalized)) {
    return {
      kind: 'runtime-script',
      normalizedArg: normalized,
    }
  }

  return {
    kind: 'other',
    normalizedArg: normalized,
  }
}
