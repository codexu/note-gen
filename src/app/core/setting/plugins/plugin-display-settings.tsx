'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FieldError, FieldGroup } from '@/components/ui/field'
import { PluginSettingsRow } from '@/components/plugins/plugin-settings-layout'
import { SettingSection } from '../components/setting-base'
import { Switch } from '@/components/ui/switch'
import { usePluginStore } from '@/stores/plugins'
import type { InstalledPlugin } from '@/lib/plugins/types'
import { getPluginDisplayLocations, isPluginDisplayVisible, type PluginDisplayLocation } from '@/lib/plugins/display-preferences'

export function PluginDisplaySettings({ plugin }: { plugin: InstalledPlugin }) {
  const t = useTranslations('settings.plugins.display')
  const id = useId()
  const settings = usePluginStore(state => state.deviceSettings)
  const save = usePluginStore(state => state.setDisplayVisibility)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locations = getPluginDisplayLocations(plugin)
  if (!locations.length) return null
  async function update(location: PluginDisplayLocation, visible: boolean) {
    setSaving(true)
    setError(null)
    try { await save(plugin.manifest.id, location, visible) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  return <SettingSection title={t('title')} desc={t('description')}>
    <FieldGroup className="gap-3">
      {locations.map(location => <PluginSettingsRow key={location} id={`${id}-${location}`} title={t(`locations.${location}`)} disabled={saving} toggle>
        <Switch id={`${id}-${location}`} checked={isPluginDisplayVisible(settings, plugin.manifest.id, location)} disabled={saving}
          onCheckedChange={visible => void update(location, visible)} />
      </PluginSettingsRow>)}
    </FieldGroup>
    <FieldError>{error}</FieldError>
  </SettingSection>
}
