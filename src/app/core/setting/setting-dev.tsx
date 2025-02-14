import { SettingRow, SettingType } from "./setting-base";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { BaseDirectory, exists, remove } from "@tauri-apps/plugin-fs";
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Store } from "@tauri-apps/plugin-store";
import { _t } from '@/locales/index';

export function SettingDev({id, icon}: {id: string, icon?: React.ReactNode}) {
  const { toast } = useToast()

  async function handleClearData() {
    const res = await confirm(_t('setting_dev_confirm_clear_data_message'), {
      title: _t('setting_dev_confirm_clear_data_title'),
      kind: 'warning',
    })
    if (res) {
      const store = await Store.load('store.json');
      await store.clear()
      await remove('store.json', { baseDir: BaseDirectory.AppData })
      await remove('note.db', { baseDir: BaseDirectory.AppData })
      message(_t('setting_dev_message_data_cleared'), {
        title: _t('setting_dev_message_restart_title'),
        kind: 'info',
      }).then(async () => {
        await getCurrentWindow().close();
      })
    }
  }

  async function handleClearFile() {
    const res = await confirm(_t('setting_dev_confirm_clear_file_message'), {
      title: _t('setting_dev_confirm_clear_file_title'),
      kind: 'warning',
    })
    if (res) {
      const folders = ['screenshot', 'article', 'clipboard', 'image']
      for (const folder of folders) {
        const isFolderExists = await exists(folder, { baseDir: BaseDirectory.AppData})
        if (isFolderExists) {
          await remove(folder, { baseDir: BaseDirectory.AppData, recursive: true })
        }
      }
      toast({ title: _t('setting_dev_toast_files_cleared') })
    }
  }

  return (
    <SettingType id={id} icon={icon} title={_t('setting_dev_tools_title')}>
      <SettingRow border>
        {_t('setting_dev_clear_data_info')}
        <Button variant={"destructive"} onClick={handleClearData}>{_t('setting_dev_clear_data_button')}</Button>
      </SettingRow>
      <SettingRow border>
        {_t('setting_dev_clear_file_info')}
        <Button variant={"destructive"} onClick={handleClearFile}>{_t('setting_dev_clear_file_button')}</Button>
      </SettingRow>
    </SettingType>
  )
}
