import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormItem, SettingRow, SettingType } from "./setting-base";
import useSettingStore from "@/stores/setting"
import { useEffect } from "react"
import { Store } from "@tauri-apps/plugin-store";
import { _t, updateLanguage } from "@/locales" // 引入 updateLanguage
import { supportedLocales } from "@/locales" // 引入 supportedLocales
import { toast } from "@/hooks/use-toast";

export function SettingLocale({id, icon}: {id: string, icon?: React.ReactNode}) {
  const { language, setLanguage, initSettingData } = useSettingStore()

  useEffect(() => {
    initSettingData()
  }, [initSettingData])


  async function localeSelectChange(value: string) {
    await setLanguage(value)
    const store = await Store.load('store.json');
    await store.set(`language`, value)
    await updateLanguage(value)
  }

  return (
    <SettingType id={id} icon={icon} title={_t('language')}>
      <SettingRow>
        <FormItem title="Language">
          <Select value={language} onValueChange={localeSelectChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={_t('select_language')} />
            </SelectTrigger>
            <SelectContent>
              {supportedLocales.map((locale) => (
                <SelectItem key={locale.code} value={locale.code}>
                  {locale.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormItem>
      </SettingRow>
    </SettingType>
  )
}
