import { PluginError } from '@notegen/plugin-api'

const actions = new Map<string, number>()
export async function withPluginUserAction<T>(pluginId: string, action: () => Promise<T>): Promise<T> {
  actions.set(pluginId, (actions.get(pluginId) ?? 0) + 1)
  try { return await action() }
  finally {
    const remaining = (actions.get(pluginId) ?? 1) - 1
    if (remaining) actions.set(pluginId, remaining)
    else actions.delete(pluginId)
  }
}
export function requirePluginUserAction(pluginId: string): void {
  if (!actions.has(pluginId)) throw new PluginError('PermissionDenied', 'Clipboard and file export require a user-invoked plugin command')
}
