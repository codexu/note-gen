import { parseArticleStyles } from './documents'

const styles = new Map<string, { owner: AbortSignal; node: HTMLStyleElement }>()
export function setPluginEditorStyles(pluginId: string, owner: AbortSignal, css: string): void {
  const rules = parseArticleStyles(css)
  const next = rules.map(rule => {
    const selectors = rule.selectorText.split(',').map(selector => selector.trim().replace(/^\.article/, '.tiptap-editor .tiptap.ProseMirror'))
    return `${selectors.join(',')} { ${rule.style.cssText} }`
  }).join('\n')
  const current = styles.get(pluginId)
  current?.node.remove()
  const node = document.createElement('style')
  node.dataset.pluginEditorStyles = pluginId
  node.textContent = next
  document.head.appendChild(node)
  styles.set(pluginId, { owner, node })
}
export function clearPluginEditorStyles(pluginId: string, owner: AbortSignal): void {
  const current = styles.get(pluginId)
  if (current?.owner !== owner) return
  current.node.remove()
  styles.delete(pluginId)
}
