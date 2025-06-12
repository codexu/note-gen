import { SettingRow, SettingType } from "../components/setting-base";
import { Button } from "@/components/ui/button";
import { useTranslations } from 'next-intl';
import { useToast } from "@/hooks/use-toast";
import { BaseDirectory, exists, remove } from "@tauri-apps/plugin-fs";
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Store } from "@tauri-apps/plugin-store";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import SetConfig from "./set-config";

export function SettingDev({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations();
  const [proxy, setProxy] = useState('');
  const { toast } = useToast()

  async function handleClearData() {
    const res = await confirm(t('settings.dev.clearDataConfirm'), {
      title: t('settings.dev.clearData'),
      kind: 'warning',
    })
    if (res) {
      const store = await Store.load('store.json');
      await store.clear()
      await remove('store.json', { baseDir: BaseDirectory.AppData })
      await remove('note.db', { baseDir: BaseDirectory.AppData })
      message('数据已清理，请重启应用', {
        title: '重启应用',
        kind: 'info',
      }).then(async () => {
        await getCurrentWindow().close();
      })
    }
  }

  async function handleClearFile() {
    const res = await confirm('确定清理文件吗？清理后将无法恢复！', {
      title: '清理文件',
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
      toast({ title: '文件已清理' })
    }
  }

  async function proxyChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    setProxy(e.target.value)
    const store = await Store.load('store.json');
    await store.set('proxy', e.target.value)
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      const proxy = await store.get<string>('proxy')
      if (proxy) {
        setProxy(proxy)
      }
    }
    init()
  }, [])

  return (
    <SettingType id={id} icon={icon} title={t('settings.dev.title')}>
      <SettingRow border className="gap-4 flex-col lg:flex-row !items-start lg:items-center">
        <span>{t('settings.dev.proxy')}</span>
        <Input className="max-w-[400px]" placeholder={t('settings.dev.proxyPlaceholder')} value={proxy} onChange={proxyChangeHandler} />
      </SettingRow>
      <SettingRow border className="gap-4 flex-col lg:flex-row !items-start lg:items-center">
        <span>清理数据信息，包括系统配置信息、数据库（包含记录）。</span>
        <Button variant={"destructive"} onClick={handleClearData}>清理</Button>
      </SettingRow>
      <SettingRow border className="gap-4 flex-col lg:flex-row !items-start lg:items-center">
        <span>清理文件，包括图片、文章。</span>
        <Button variant={"destructive"} onClick={handleClearFile}>清理</Button>
      </SettingRow>
      <SetConfig />
    </SettingType>
  )
}