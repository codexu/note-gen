'use client'
import { useLocale, useTranslations } from 'next-intl'
import { Palette } from 'lucide-react'
import { Item, ItemContent, ItemTitle, ItemMedia, ItemActions } from '@/components/ui/item'
import { ResponsiveSelect } from '@/components/responsive-select'
import { selectPluginTheme, usePluginResources } from '@/lib/plugins/resources'
import { usePluginStore } from '@/stores/plugins'
import { getLoadedPluginMessages, usePluginLocalization } from '@/lib/plugins/localization'
import { resolveManifestText } from '@/lib/plugins/manifest'
export function PluginThemeSelector() {
  const t = useTranslations('settings.general.interface')
  const locale = useLocale()
  const installed = usePluginStore(state => state.installed)
  usePluginLocalization(installed, locale)
  const { entries, selectedTheme } = usePluginResources()
  const options = entries.flatMap(({ plugin, resources }) => (resources.themes ?? []).map(theme => ({ value: `${plugin.manifest.id}:${theme.id}`, label: resolveManifestText(theme.name, getLoadedPluginMessages(plugin.manifest.id, locale)) ?? theme.name })))
  return <Item variant="outline">
    <ItemMedia variant="icon"><Palette /></ItemMedia>
    <ItemContent><ItemTitle>{t('themePackage.title')}</ItemTitle></ItemContent>
    <ItemActions><ResponsiveSelect title={t('themePackage.title')} value={options.some(x => x.value === selectedTheme) ? selectedTheme : '@default'} onValueChange={value => selectPluginTheme(value === '@default' ? '' : value)} options={[{ value: '@default', label: t('themePackage.default') }, ...options]} /></ItemActions>
  </Item>
}
