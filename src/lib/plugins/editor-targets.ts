import type { Editor } from '@tiptap/core'
import { PluginError, type PluginEditorTargetSnapshot, type PluginMenuContext } from '@notegen/plugin-api'
import { onDidChangeActivePluginEditor } from './editor-bridge'

interface TargetEntry {
  pluginId: string
  editor: Editor
  doc: Editor['state']['doc']
  selection: Editor['state']['selection']
  kind: PluginMenuContext['nodeKind']
  position?: number
  expiresAt: number
}

const targets = new Map<string, TargetEntry>()
onDidChangeActivePluginEditor(() => { targets.clear() })

export function issuePluginEditorTarget(pluginId: string, editor: Editor, kind?: PluginMenuContext['nodeKind'], position?: number): string {
  if (editor.isDestroyed) throw new PluginError('StaleRevision', 'The editor is no longer available')
  const token = crypto.randomUUID()
  if (targets.size >= 128) targets.delete(targets.keys().next().value!)
  targets.set(token, { pluginId, editor, doc: editor.state.doc, selection: editor.state.selection, kind, position, expiresAt: Date.now() + 60_000 })
  return token
}

export function readPluginEditorTarget(pluginId: string, token: string): PluginEditorTargetSnapshot {
  const target = targets.get(token)
  if (!target || target.pluginId !== pluginId) throw new PluginError('NotFound', 'Editor target is unavailable')
  if (Date.now() > target.expiresAt || target.editor.isDestroyed
    || target.editor.state.doc !== target.doc || !target.editor.state.selection.eq(target.selection)) {
    targets.delete(token)
    throw new PluginError('StaleRevision', 'Editor target changed')
  }
  const { doc, selection } = target.editor.state
  let node = target.position === undefined ? selection.$from.parent : doc.nodeAt(target.position)
  if (!node) throw new PluginError('StaleRevision', 'Editor node changed')
  if (target.kind === 'image' && target.position !== undefined && node.type.name !== 'image') {
    throw new PluginError('StaleRevision', 'Editor image changed')
  }
  if (target.position === undefined && target.kind) {
    for (let depth = selection.$from.depth; depth >= 0; depth--) {
      const ancestor = selection.$from.node(depth)
      if (ancestor.type.name === target.kind || (target.kind === 'math' && ancestor.type.name === 'blockMath')) {
        node = ancestor
        break
      }
    }
    if (target.kind === 'math' && node.type.name !== 'blockMath') {
      const adjacent = doc.nodeAt(selection.from)
      if (adjacent?.type.name === 'inlineMath') node = adjacent
    }
  }
  const attributes: Record<string, string | number | boolean | null> = {}
  for (const key of ['alt', 'title', 'language', 'width', 'height', 'align', 'textAlign', 'relativeSrc', ...(target.kind === 'math' ? ['content'] : [])]) {
    const value: unknown = node.attrs[key]
    if (typeof value === 'string' && value.length <= 1024
      && (key !== 'relativeSrc' || (!value.startsWith('/') && !value.includes('\\') && !/^[A-Za-z]:/.test(value) && !value.split('/').includes('..')))) attributes[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) attributes[key] = value
    else if (typeof value === 'boolean' || value === null) attributes[key] = value
  }
  if (target.kind === 'link') {
    const href: unknown = target.editor.getAttributes('link').href
    if (typeof href === 'string' && href.length <= 2048 && !/^(?:file:|\/|\\|[A-Za-z]:[\\/])/i.test(href)) attributes.href = href
  }
  const children = [] as Array<{ type: string; text: string }>
  for (let index = 0; index < Math.min(node.childCount, 32); index++) {
    const child = node.child(index)
    children.push({ type: child.type.name, text: child.textContent.slice(0, 1024) })
  }
  return {
    nodeKind: target.kind,
    nodeType: node.type.name,
    text: node.textContent.slice(0, 4096),
    attributes,
    children,
    truncated: node.childCount > 32 || node.textContent.length > 4096,
  }
}
