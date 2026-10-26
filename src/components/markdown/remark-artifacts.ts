import { parseChatArtifactHref } from '@/lib/chat-artifacts'

interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

export const ARTIFACT_LINK_PREFIX = '#notegen-artifact-'

export interface ArtifactLinkTarget {
  absolutePath: string
}

export interface ArtifactRemarkOptions {
  targets: ArtifactLinkTarget[]
  paths: Record<string, string>
}

function pathIdentity(path: string): string {
  return /^[a-zA-Z]:\//.test(path) || path.startsWith('//') ? path.toLowerCase() : path
}

function isPathBoundary(value: string | undefined): boolean {
  return value === undefined || !/[\p{L}\p{N}_/\\.%:-]/u.test(value)
}

/** Convert only recorded artifact paths before Markdown's normal URL sanitization. */
export function remarkArtifacts({ targets, paths }: ArtifactRemarkOptions) {
  const tokens = new Map(targets.map((target, index) => [target.absolutePath, `${ARTIFACT_LINK_PREFIX}${index}`]))
  const exactAliases = new Map<string, string>()
  const aliases = new Map<string, string | null>()
  for (const [alias, absolutePath] of Object.entries(paths)) {
    // Metadata holds native filenames. Encode '%' before URI parsing so a
    // literal a%20b.pdf cannot collide with a b.pdf.
    const normalized = parseChatArtifactHref(encodeURI(alias))
    const token = tokens.get(absolutePath)
    if (!token) continue
    exactAliases.set(alias, token)
    if (normalized) {
      const key = pathIdentity(normalized)
      aliases.set(key, aliases.has(key) && aliases.get(key) !== token ? null : token)
    }
  }
  const getUrlToken = (path: string) => {
    const normalized = parseChatArtifactHref(path)
    return normalized ? aliases.get(pathIdentity(normalized)) : undefined
  }
  const getNativeToken = (path: string) => {
    const exact = exactAliases.get(path)
    if (exact) return exact
    const normalized = parseChatArtifactHref(encodeURI(path))
    return normalized ? aliases.get(pathIdentity(normalized)) : undefined
  }
  const textPaths = Object.keys(paths).sort((left, right) => right.length - left.length)

  const linkText = (value: string): MarkdownNode[] => {
    const result: MarkdownNode[] = []
    let offset = 0
    while (offset < value.length) {
      let found: { index: number; path: string; token: string } | undefined
      for (const path of textPaths) {
        let index = value.indexOf(path, offset)
        while (index !== -1) {
          if (isPathBoundary(value[index - 1]) && isPathBoundary(value[index + path.length])) {
            const token = getNativeToken(path)
            if (token && (!found || index < found.index)) found = { index, path, token }
            break
          }
          index = value.indexOf(path, index + 1)
        }
      }
      if (!found) {
        result.push({ type: 'text', value: value.slice(offset) })
        break
      }
      if (found.index > offset) result.push({ type: 'text', value: value.slice(offset, found.index) })
      result.push({ type: 'link', url: found.token, children: [{ type: 'text', value: found.path }] })
      offset = found.index + found.path.length
    }
    return result
  }

  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode, depth = 0): void => {
      if (depth > 64 || node.type === 'code' || node.type === 'html' || node.type === 'image') return
      if (node.type === 'link' || node.type === 'definition') {
        const token = typeof node.url === 'string' ? getUrlToken(node.url) : undefined
        if (token) node.url = token
        return
      }
      if (!node.children || node.type === 'linkReference') return
      node.children = node.children.flatMap(child => {
        if (child.type === 'inlineCode' && typeof child.value === 'string') {
          const token = getNativeToken(child.value)
          return token ? [{ type: 'link', url: token, children: [{ type: 'text', value: child.value }] }] : [child]
        }
        if (child.type === 'text' && typeof child.value === 'string') return linkText(child.value)
        visit(child, depth + 1)
        return [child]
      })
    }
    visit(tree)
  }
}
