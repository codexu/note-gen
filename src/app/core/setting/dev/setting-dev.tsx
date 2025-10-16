import { SettingType } from "../components/setting-base";
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
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
import { Network, Database, FolderX } from "lucide-react";

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
    <SettingType id={id} icon={icon} title={t('settings.dev.title')} desc={t('settings.dev.desc')}>
      <ItemGroup className="gap-4">
        <Item variant="outline">
          <ItemMedia variant="icon"><Network className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.dev.proxyTitle')}</ItemTitle>
            <ItemDescription>{t('settings.dev.proxy')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Input className="w-[300px]" placeholder={t('settings.dev.proxyPlaceholder')} value={proxy} onChange={proxyChangeHandler} />
          </ItemActions>
        </Item>
        
        <Item variant="outline">
          <ItemMedia variant="icon"><Database className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.dev.clearDataTitle')}</ItemTitle>
            <ItemDescription>{t('settings.dev.clearDataDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant={"destructive"} onClick={handleClearData}>{t('settings.dev.clearButton')}</Button>
          </ItemActions>
        </Item>
        
        <Item variant="outline">
          <ItemMedia variant="icon"><FolderX className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('settings.dev.clearFileTitle')}</ItemTitle>
            <ItemDescription>{t('settings.dev.clearFileDesc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant={"destructive"} onClick={handleClearFile}>{t('settings.dev.clearButton')}</Button>
          </ItemActions>
        </Item>
        <SetConfig />
      </ItemGroup>
    </SettingType>
  )
}