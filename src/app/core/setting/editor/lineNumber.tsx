import { Switch } from "@/components/ui/switch";
import { SettingPanel } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { useEffect, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";

export default function LineNumber() {
  const t = useTranslations('settings.editor');
  const [state, setState] = useState(false)

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const enableLineNumber = await store.get<boolean>('enableLineNumber') || false
      setState(enableLineNumber)
    }
    init()
  }, [])

  async function setStateHandler(state: boolean) {
    const store = await Store.load('store.json');
    await store.set('enableLineNumber', state)
    setState(state)
  }

  return <SettingPanel title={t('enableLineNumber')} desc={t('enableLineNumberDesc')}>
    <Switch checked={state} onCheckedChange={setStateHandler}/>
  </SettingPanel>
}