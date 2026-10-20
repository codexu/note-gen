import { create } from 'zustand'
import { invokePluginBackend } from './backend'
import { usePluginStore } from '@/stores/plugins'
import useSettingStore from '@/stores/setting'

interface ReloadTarget { token: string; path: string; revision?: string; error?: string }
const useDevelopmentReloadStore = create<{ targets: Record<string, ReloadTarget> }>(() => ({ targets: {} }))

/** Main-window only. Never executes shell commands; observes validated CLI package output. */
export function startDevelopmentAutoReload(): () => void {
  let stopped = false
  let busy = false
  const poll = async () => {
    if (stopped || busy) return
    if (!useSettingStore.getState().developerMode) {
      useDevelopmentReloadStore.setState({ targets: {} })
      return
    }
    // Follow installed development packages automatically, including after restart.
    // A changed source directory starts a fresh watcher generation.
    useDevelopmentReloadStore.setState(current => ({
      targets: Object.fromEntries(usePluginStore.getState().installed.flatMap(plugin => {
        if (plugin.source !== 'development' || !plugin.developmentPath) return []
        const previous = current.targets[plugin.manifest.id]
        const target = previous?.path === plugin.developmentPath
          ? previous
          : { token: crypto.randomUUID(), path: plugin.developmentPath }
        return [[plugin.manifest.id, target]]
      })),
    }))
    busy = true
    try {
      for (const [id, target] of Object.entries(useDevelopmentReloadStore.getState().targets)) {
        const state = usePluginStore.getState()
        const plugin = state.installed.find(item => item.manifest.id === id)
        if (!plugin || plugin.source !== 'development' || !plugin.developmentPath) continue
        if (state.operationPluginId || !state.isEnabled(id)) continue
        const stillCurrent = () => {
          const current = usePluginStore.getState()
          return !stopped && useSettingStore.getState().developerMode
            && useDevelopmentReloadStore.getState().targets[id]?.token === target.token
            && current.currentWorkspaceId === state.currentWorkspaceId && current.currentWorkspaceKey === state.currentWorkspaceKey
            && current.installed.find(item => item.manifest.id === id)?.developmentPath === plugin.developmentPath
            && current.isEnabled(id)
        }
        const patch = (value: Partial<ReloadTarget>) => {
          if (!stillCurrent()) return
          useDevelopmentReloadStore.setState(current => ({ targets: { ...current.targets, [id]: { ...current.targets[id], ...value } } }))
        }
        try {
          const revisions = await invokePluginBackend<{ source: string; installed: string }>('plugin_development_revision', { pluginId: id })
          const revision = revisions.source
          if (!stillCurrent() || usePluginStore.getState().operationPluginId) continue
          if (revision === revisions.installed) { patch({ revision, error: undefined }); continue }
          if (target.revision === revision) continue
          // One import attempt per complete build. A failed import waits for another successful build or a fresh host session.
          patch({ revision, error: undefined })
          await usePluginStore.getState().importDevelopment(plugin.developmentPath, id)
          usePluginStore.getState().addLog({ pluginId: id, level: 'info', message: 'Development package reloaded. Expanded permissions still require review.' })
        } catch (error) {
          if (!stillCurrent()) continue
          const message = error instanceof Error ? error.message : String(error)
          if (useDevelopmentReloadStore.getState().targets[id]?.error !== message) {
            usePluginStore.getState().addLog({ pluginId: id, level: 'warning', message: `Auto-reload: ${message}` })
          }
          patch({ error: message })
        }
      }
    } finally { busy = false }
  }
  const timer = setInterval(() => { void poll() }, 2_000)
  void poll()
  return () => { stopped = true; clearInterval(timer); useDevelopmentReloadStore.setState({ targets: {} }) }
}
