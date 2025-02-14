import useSettingStore from "@/stores/setting";
import { OpenBroswer } from "@/components/open-broswer";
import { SettingRow, SettingType } from "./setting-base";
import { useEffect, useState } from 'react';
// import { Button } from "@/components/ui/button";
import { _t } from '@/locales';

export function SettingAbout({id, icon}: {id: string, icon?: React.ReactNode}) {
  const { version } = useSettingStore()
  const [ isClient, setIsClient ] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, [])

  if (!isClient) {
    return null; // or a loading state
  }

  return (
    <SettingType id={id} icon={icon} title={_t('about_settings_title')}>
      <SettingRow>
        <span>
          NoteGen v{version}，<OpenBroswer title={_t('query_history_version')} url="https://github.com/codexu/note-gen/releases" />。
        </span>
        {/* <Button disabled>{_t('check_update')}</Button> */}
      </SettingRow>
    </SettingType>
  )
}
