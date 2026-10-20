import { PluginError, type PluginHostCommand } from '@notegen/plugin-api'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { useSidebarStore } from '@/stores/sidebar'
import { cancelPluginViewNavigation } from './ui-registry'

export async function executeHostCommand(command: PluginHostCommand): Promise<void> {
  if (typeof window === 'undefined' || !window.location.pathname.startsWith('/core/')) {
    throw new PluginError('UnavailableOnPlatform', 'Host navigation requires the desktop main window')
  }
  switch (command) {
    case 'app.openSearch': {
      cancelPluginViewNavigation()
      const sidebar = useSidebarStore.getState()
      // Both UI mutations happen synchronously before their persistence awaits.
      await Promise.all([sidebar.setLeftSidebarTab('files'), sidebar.requestSidebarSearchFocus()])
      return
    }
    case 'app.openSettings':
      useSettingsDialogStore.getState().openSettings('general')
      return
    case 'app.openPluginSettings':
      useSettingsDialogStore.getState().openSettings('plugins')
      return
    default:
      throw new PluginError('PermissionDenied', 'Host command is not allowlisted')
  }
}
