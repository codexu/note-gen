import type { SyNode } from './types.ts'
import { isSafeSiYuanBlockId } from './utils.ts'

export function extractBlockQueryEmbedScript(node: SyNode): string {
  for (const child of node.Children ?? []) {
    if (child.Type === 'NodeBlockQueryEmbedScript') {
      return (child.Data ?? '').trim()
    }
  }
  return ''
}

export function parseBlockQueryEmbedBlockId(script: string): string | null {
  const match = script.trim().match(/\bid\s*=\s*['"]([^'"]+)['"]/i)
  if (!match) {
    return null
  }

  const blockId = match[1]
  return isSafeSiYuanBlockId(blockId) ? blockId : null
}

export function isBlockQueryEmbedResolvable(
  node: SyNode,
  blockIndex: Map<string, unknown>,
): boolean {
  const script = extractBlockQueryEmbedScript(node)
  const refId = script ? parseBlockQueryEmbedBlockId(script) : null
  return Boolean(refId && blockIndex.has(refId))
}
