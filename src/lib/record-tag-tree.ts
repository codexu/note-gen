import type { Tag } from '@/db/tags'

export interface RecordTagNode {
  path: string
  label: string
  tag?: Tag
  children: RecordTagNode[]
}

/** Missing parents are presentation nodes, never a reason to mutate old data. */
export function buildRecordTagTree(tags: Tag[]): RecordTagNode[] {
  const nodes = new Map<string, RecordTagNode>()
  const roots: RecordTagNode[] = []
  for (const tag of tags) {
    const parts = tag.name.split('/')
    let siblings = roots
    for (let index = 0; index < parts.length; index++) {
      const path = parts.slice(0, index + 1).join('/')
      let node = nodes.get(path)
      if (!node) {
        node = { path, label: parts[index], children: [] }
        nodes.set(path, node)
        siblings.push(node)
      }
      if (index === parts.length - 1) node.tag = tag
      siblings = node.children
    }
  }
  const sort = (items: RecordTagNode[]) => {
    items.sort((a, b) => (a.tag?.sortOrder ?? 0) - (b.tag?.sortOrder ?? 0) || a.path.localeCompare(b.path))
    items.forEach(node => sort(node.children))
  }
  sort(roots)
  return roots
}
