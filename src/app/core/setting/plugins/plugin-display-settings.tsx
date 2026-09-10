'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
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
  return <FieldSet>
    <FieldLegend>{t('title')}</FieldLegend>
    <FieldDescription>{t('description')}</FieldDescription>
    <FieldGroup>
      {locations.map(location => <Field key={location} orientation="responsive" data-disabled={saving}>
        <FieldContent><FieldLabel htmlFor={`${id}-${location}`}>{t(`locations.${location}`)}</FieldLabel></FieldContent>
        <Switch id={`${id}-${location}`} checked={isPluginDisplayVisible(settings, plugin.manifest.id, location)} disabled={saving}
          onCheckedChange={visible => void update(location, visible)} />
      </Field>)}
    </FieldGroup>
    <FieldError>{error}</FieldError>
  </FieldSet>
}
