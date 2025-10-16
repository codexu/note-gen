import { Button } from "@/components/ui/button";
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { FileJson } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useToast } from "@/hooks/use-toast";
import { BaseDirectory, copyFile, readTextFile } from "@tauri-apps/plugin-fs";
import { Store } from "@tauri-apps/plugin-store";
import { isMobileDevice } from "@/lib/check";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslations } from 'next-intl';

export default function SetConfig() {
    const t = useTranslations('settings.dev');
    const { toast } = useToast()
    async function handleImport() {
      const file = await open({
        title: t('importConfigTitle'),
      })
      if (file) {
        const content = await readTextFile(file, { baseDir: BaseDirectory.AppData })
        const jsonContent = JSON.parse(content)
        const store = await Store.load('store.json');
        Object.keys(jsonContent).forEach((key: string) => {
          store.set(key, jsonContent[key])
        })
        if (isMobileDevice()) {
          toast({
            description: t('importConfigSuccessMobile'),
          })
        } else {
          relaunch()
        }
      }
    }
    async function handleExport() {
      const file = await save({
        title: t('exportConfigTitle'),
        defaultPath: 'store.json',
      })
      if (file) {
        await copyFile('store.json', file, { fromPathBaseDir: BaseDirectory.AppData })
        toast({ title: t('exportConfigSuccess') })
      }
    }
    return (
    <Item variant="outline">
      <ItemMedia variant="icon"><FileJson className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('configFileTitle')}</ItemTitle>
        <ItemDescription>{t('configFileDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" onClick={handleImport}>{t('importButton')}</Button>
        <Button variant="outline" onClick={handleExport}>{t('exportButton')}</Button>
      </ItemActions>
    </Item>
  )
}