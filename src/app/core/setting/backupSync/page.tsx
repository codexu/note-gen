'use client';
import { FileUp } from "lucide-react"
import { useTranslations } from 'next-intl';
import { SettingType } from '../components/setting-base';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WebdavSync from './webdav-sync';
import LocalBackup from './local-backup';

export default function SyncPage() {
  const t = useTranslations('settings.backupSync');
  
  return (
    <SettingType id="sync" icon={<FileUp />} title={t('title')} desc={t('desc')}>
      <Tabs defaultValue="Local">
        <TabsList className="grid grid-cols-2 w-full mb-4">
          <TabsTrigger value="Local">{t('localBackup.tabTitle')}</TabsTrigger>
          <TabsTrigger value="Webdav">Webdav</TabsTrigger>
        </TabsList>
        <TabsContent value="Local">
          <LocalBackup />
        </TabsContent>
        <TabsContent value="Webdav">
          <WebdavSync />
        </TabsContent>
      </Tabs>
    </SettingType>
  )
}
