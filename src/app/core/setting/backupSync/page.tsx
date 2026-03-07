'use client';
import { FileUp } from "lucide-react"
import { useTranslations } from 'next-intl';
import { SettingType } from '../components/setting-base';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LocalBackup from './local-backup';

export default function SyncPage() {
  const t = useTranslations('settings.backupSync');

  return (
    <SettingType id="sync" icon={<FileUp />} title={t('title')} desc={t('desc')}>
      <Tabs defaultValue="Local">
        <TabsList className="grid grid-cols-1 w-full mb-4">
          <TabsTrigger value="Local">{t('localBackup.tabTitle')}</TabsTrigger>
        </TabsList>
        <TabsContent value="Local">
          <LocalBackup />
        </TabsContent>
      </Tabs>
    </SettingType>
  )
}
