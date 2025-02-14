import { Input } from "@/components/ui/input";
import { FormItem, SettingRow, SettingType } from "./setting-base";
import { useEffect } from "react";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { OpenBroswer } from "@/components/open-broswer";
import { _t } from '@/locales';

export function SettingOCR({id, icon}: {id: string, icon?: React.ReactNode}) {
  const { tesseractList, setTesseractList } = useSettingStore()

  async function changeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    setTesseractList(e.target.value)
    const store = await Store.load('store.json');
    await store.set('tesseractList', e.target.value)
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const list = await store.get<string>('tesseractList')
      if (list) {
        setTesseractList(list)
      } else {
        setTesseractList('')
      }
    }
    init()
  }, [])

  return (
    <SettingType id={id} icon={icon} title={_t('ocr_settings_title')}>
      <SettingRow>
        <FormItem title={_t('language_package')}>
          <Input value={tesseractList} onChange={changeHandler} />
        </FormItem>
      </SettingRow>
      <SettingRow>
        <span>
          <OpenBroswer title={_t('query_all_models')} url="https://tesseract-ocr.github.io/tessdoc/Data-Files#data-files-for-version-400-november-29-2016" />
          ，{_t('separate_by_commas')}
        </span>
      </SettingRow>
    </SettingType>
  )
}
