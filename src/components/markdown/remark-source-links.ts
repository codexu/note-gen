import { isResponseNotePath } from '@/lib/chat-ui/response-catalog'

export const SOURCE_LINK_PREFIX = '#notegen-source-'

interface MarkdownNode {
  type: string
  url?: string
  children?: MarkdownNode[]
}

function articleKey(href: string, encoded = true): string | null {
  if (!href.startsWith('article:')) return null
  try {
    const raw = href.slice('article:'.length)
    const path = encoded ? decodeURIComponent(raw) : raw
    return isResponseNotePath(path) ? `article:${path}` : null
  } catch { return null }
}

/** Convert only actual knowledge citations before the ordinary URL sanitizer runs. */
export function remarkSourceLinks({ sourceKeys }: { sourceKeys: string[] }) {
  const links = new Map(sourceKeys.flatMap((key, index) => {
    const normalized = articleKey(key, false)
    return normalized ? [[normalized, `${SOURCE_LINK_PREFIX}${index}`] as const] : []
  }))
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode, depth = 0): void => {
      if (depth > 64 || node.type === 'code' || node.type === 'html' || node.type === 'image') return
      if ((node.type === 'link' || node.type === 'definition') && node.url) {
        const key = articleKey(node.url)
        const token = key ? links.get(key) : undefined
        if (token) node.url = token
        return
      }
      node.children?.forEach(child => visit(child, depth + 1))
    }
    visit(tree)
  }
}

export function sourceLinkIndex(href: string | undefined): number | null {
  if (!href?.startsWith(SOURCE_LINK_PREFIX)) return null
  const value = href.slice(SOURCE_LINK_PREFIX.length)
  return /^(?:0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
}
