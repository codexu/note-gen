import { Button } from "@/components/ui/button";
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { FileJson } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useToast } from "@/hooks/use-toast";
import { BaseDirectory, copyFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Store } from "@tauri-apps/plugin-store";
import { isMobileDevice } from "@/lib/check";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslations } from 'next-intl';

export default function SetConfig() {
    const t = useTranslations('settings.dev');
    const { toast } = useToast()
    async function handleImport() {
      try {
        const file = await open({
          title: t('importConfigTitle'),
        })
        if (file) {
          // 验证 JSON 格式
          const content = await readTextFile(file)
          JSON.parse(content)

          // 直接将文件写入 store.json 位置
          await writeTextFile('store.json', content, { baseDir: BaseDirectory.AppData })

          // 关闭已加载的 store 实例（如果有）
          const existingStore = await Store.get('store.json')
          if (existingStore) {
            await existingStore.close()
          }

          // 重新加载 store，会自动从磁盘读取新写入的文件
          await Store.load('store.json')

          if (isMobileDevice()) {
            toast({
              description: t('importConfigSuccessMobile'),
            })
          } else {
            relaunch()
          }
        }
      } catch (error) {
        toast({
          title: '导入失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive'
        })
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