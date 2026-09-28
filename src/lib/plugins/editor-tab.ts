const PREFIX = 'plugin://view/'

export function pluginEditorTabPath(pluginId: string, viewId: string): string {
  return `${PREFIX}${encodeURIComponent(pluginId)}/${encodeURIComponent(viewId)}`
}

export function parsePluginEditorTabPath(path: string): { pluginId: string; viewId: string } | null {
  if (!path.startsWith(PREFIX)) return null
  const parts = path.slice(PREFIX.length).split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  try {
    const pluginId = decodeURIComponent(parts[0])
    const viewId = decodeURIComponent(parts[1])
    return pluginId && viewId ? { pluginId, viewId } : null
  } catch { return null }
}
