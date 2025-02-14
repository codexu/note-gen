import { SettingRow, SettingType } from "./setting-base";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { useEffect } from "react";
import { _t } from '@/locales';

export function PreviewThemeSelect() {
  const { previewTheme, setPreviewTheme } = useSettingStore()

  const themes = ['github', 'vuepress', 'mk-cute', 'smart-blue', 'cyanosis']

  async function changeHandler(e: string) {
    setPreviewTheme(e)
    const store = await Store.load('store.json');
    store.set('previewTheme', e)
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const theme = await store.get<string>('previewTheme')
      if (theme) {
        setPreviewTheme(theme)
      } else {
        setPreviewTheme(themes[0])
      }
    }
    init()
  }, [])

  return (
    <Select onValueChange={changeHandler} value={previewTheme}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={_t('select_theme')} />
      </SelectTrigger>
      <SelectContent>
        {
          themes.map((theme) => (
            <SelectItem key={theme} value={theme}>{theme}</SelectItem>
          ))
        }
      </SelectContent>
    </Select>
  )
}

export function CodeThemeSelect() {
  const { codeTheme, setCodeTheme } = useSettingStore()
  const themes = ['github', 'atom', 'a11y', 'gradient', 'kimbie', 'paraiso', 'qtcreator', 'stackoverflow']

  async function changeHandler(e: string) {
    setCodeTheme(e)
    const store = await Store.load('store.json');
    store.set('codeTheme', e)
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const theme = await store.get<string>('codeTheme')
      if (theme) {
        setCodeTheme(theme)
      } else {
        setCodeTheme(themes[0])
      }
    }
    init()
  }, [])

  return (
    <Select onValueChange={changeHandler} value={codeTheme}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={_t('select_theme')} />
      </SelectTrigger>
      <SelectContent>
        {
          themes.map((theme) => (
            <SelectItem key={theme} value={theme}>{theme}</SelectItem>
          ))
        }
      </SelectContent>
    </Select>
  )
}

export function SettingTheme({id, icon}: {id: string, icon?: React.ReactNode}) {

  return (
    <SettingType id={id} icon={icon} title={_t('theme_settings_title')}>
      <SettingRow border>
        <span>{_t('preview_content_theme')}</span>
        <PreviewThemeSelect />
      </SettingRow>
      <SettingRow border>
        <span>{_t('code_block_highlight_theme')}</span>
        <CodeThemeSelect />
      </SettingRow>
    </SettingType>
  )
}
