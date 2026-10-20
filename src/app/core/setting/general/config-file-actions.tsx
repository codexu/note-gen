'use client'

import { relaunch } from '@tauri-apps/plugin-process'
import { open, save } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, copyFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { useToast } from '@/hooks/use-toast'
import { isMobileDevice } from '@/lib/check'
import { Download, FileJson, Upload } from 'lucide-react'

export function ConfigFileActions() {
  const t = useTranslations('settings.dev')
  const { toast } = useToast()

  async function handleImport() {
    try {
      const file = await open({ title: t('importConfigTitle') })
      if (!file) return

      const content = await readTextFile(file)
      JSON.parse(content)
      await writeTextFile('store.json', content, { baseDir: BaseDirectory.AppData })

      const existingStore = await Store.get('store.json')
      if (existingStore) await existingStore.close()
      await Store.load('store.json')

      if (isMobileDevice()) {
        toast({ description: t('importConfigSuccessMobile') })
      } else {
        await relaunch()
      }
    } catch (error) {
      toast({
        title: '导入失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  async function handleExport() {
    const file = await save({
      title: t('exportConfigTitle'),
      defaultPath: 'store.json',
    })
    if (!file) return

    await copyFile('store.json', file, { fromPathBaseDir: BaseDirectory.AppData })
    toast({ title: t('exportConfigSuccess') })
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><FileJson /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('configFileTitle')}</ItemTitle>
        <ItemDescription>{t('configFileDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
        <ButtonGroup className="w-full sm:w-auto">
          <Button className="flex-1 sm:flex-none" variant="outline" onClick={handleImport}>
            <Upload data-icon="inline-start" />
            {t('importButton')}
          </Button>
          <Button className="flex-1 sm:flex-none" variant="outline" onClick={handleExport}>
            <Download data-icon="inline-start" />
            {t('exportButton')}
          </Button>
        </ButtonGroup>
      </ItemActions>
    </Item>
  )
}
