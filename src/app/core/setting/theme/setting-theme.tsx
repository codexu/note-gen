import { SettingRow, SettingType } from "../components/setting-base";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { useTranslations } from 'next-intl';
import { useEffect } from "react";
import { useTheme } from "next-themes";

export function PreviewThemeSelect() {
  const t = useTranslations();
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
        <SelectValue placeholder={t('settings.theme.selectTheme')} />
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

export function AppThemeSelect() {
  const t = useTranslations();
  const { theme, setTheme } = useTheme()

  const themes = [
    { value: 'light', label: '亮色' },
    { value: 'dark', label: '暗色' },
    { value: 'system', label: '跟随系统' }
  ]

  return (
    <Select onValueChange={setTheme} value={theme}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder={t('settings.theme.selectTheme')} />
      </SelectTrigger>
      <SelectContent>
        {
          themes.map((theme) => (
            <SelectItem key={theme.value} value={theme.value}>{theme.label}</SelectItem>
          ))
        }
      </SelectContent>
    </Select>
  )
}

export function CodeThemeSelect() {
  const t = useTranslations();
  const { codeTheme, setCodeTheme } = useSettingStore()

  const themes = ['github', 'github-dark', 'material-darker', 'material-palenight', 'one-dark']

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
        <SelectValue placeholder={t('settings.theme.selectTheme')} />
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
  const t = useTranslations();

  return (
    <SettingType id={id} icon={icon} title={t('settings.theme.title')}>
      <SettingRow border>
        <span>{t('settings.theme.appTheme') || '应用配色'}。</span>
        <AppThemeSelect />
      </SettingRow>
      <SettingRow border>
        <span>{t('settings.theme.previewTheme')}。</span>
        <PreviewThemeSelect />
      </SettingRow>
      <SettingRow border>
        <span>{t('settings.theme.codeTheme')}。</span>
        <CodeThemeSelect />
      </SettingRow>
    </SettingType>
  )
}