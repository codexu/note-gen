import { Input } from "@/components/ui/input";
import { FormItem } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { useEffect } from "react";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import { OpenBroswer } from "@/components/open-broswer";
import { SetDefault } from "./setDefault";

export function OcrSetting() {
  const t = useTranslations('settings.imageMethod.ocr');
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
    <div className="space-y-8">
      <FormItem title={t('languagePacks')}>
        <Input value={tesseractList} onChange={changeHandler} />
      </FormItem>
      <div>
        <span>
          <OpenBroswer title={t('checkModels')} url="https://tesseract-ocr.github.io/tessdoc/Data-Files#data-files-for-version-400-november-29-2016" />
          {t('modelInstruction')}
        </span>
      </div>
      <SetDefault type="ocr" />
    </div>
  )
}