'use client'

import { Box } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { FieldGroup } from '@/components/ui/field'
import { usePluginStore } from '@/stores/plugins'
import { usePluginLocalization } from '@/lib/plugins/localization'
import { hasPluginSettingsContent } from '@/lib/plugins/display-preferences'
import { getPluginManifestFingerprint } from '@/lib/plugins/types'
import { SettingSection, SettingType } from '../components/setting-base'
import { getInstalledPluginText, resolvePluginText } from './plugin-display'
import { PluginSettingField } from './installed-plugins-tab'
import { PluginDisplaySettings } from './plugin-display-settings'
import { PluginViewSurface } from '@/components/plugins/plugin-view-surface'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

export function PluginSettingsPage({ pluginId }: { pluginId: string }) {
  const t = useTranslations('settings.plugins')
  const locale = useLocale()
  const installed = usePluginStore(state => state.installed)
  const workspaceId = usePluginStore(state => state.currentWorkspaceId)
  const enabled = usePluginStore(state => state.isEnabled(pluginId))
  const active = useSettingsDialogStore(state => state.open && state.activeSection === `plugin:${pluginId}`)
  usePluginLocalization(installed, locale)
  const plugin = installed.find(item => item.manifest.id === pluginId)
  if (!plugin || !enabled || !hasPluginSettingsContent(plugin)) return null
  const text = getInstalledPluginText(plugin, locale)
  const settings = plugin.manifest.contributes.settings ?? []
  const views = (plugin.manifest.contributes.views ?? []).filter(view => view.location === 'settings')
  return <SettingType id={`plugin:${pluginId}`} title={text.name} desc={text.description} icon={<Box />}>
    {settings.length > 0 || (views.length > 0 && !enabled) ? <SettingSection title={t('settings.title')} desc={t('settings.desc')}>
      {settings.length ? <FieldGroup className="gap-3">
        {settings.map(setting => <PluginSettingField
          key={`${workspaceId}:${getPluginManifestFingerprint(plugin)}:${setting.key}`}
          plugin={plugin}
          setting={setting}
        />)}
      </FieldGroup> : <p className="text-sm text-muted-foreground">{t(views.length && !enabled ? 'usage.enableFirst' : 'settings.none')}</p>}
    </SettingSection> : null}
    {enabled && active ? views.map(view => <SettingSection key={`${workspaceId}:${getPluginManifestFingerprint(plugin)}:${view.id}`} title={resolvePluginText(pluginId, view.title, locale)}>
      <PluginViewSurface viewKey={`${pluginId}:${view.id}`} active={active} />
    </SettingSection>) : null}
    <PluginDisplaySettings plugin={plugin} />
  </SettingType>
}
