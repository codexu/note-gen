'use client';
import { FileUp } from "lucide-react"
import { useTranslations } from 'next-intl';
import { GithubSync } from "./github-sync";
import { GiteeSync } from "./gitee-sync";
import { SettingType } from '../components/setting-base';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WebdavSync from './webdav-sync';

export default function SyncPage() {
  const t = useTranslations();
  
  return (
    <SettingType id="sync" icon={<FileUp />} title={t('settings.sync.title')} desc={t('settings.sync.desc')}>
      <Tabs defaultValue="Github">
        <TabsList className="grid grid-cols-3 w-full lg:w-[600px] mb-8">
          <TabsTrigger value="Github">Github</TabsTrigger>
          <TabsTrigger value="Gitee">Gitee</TabsTrigger>
          <TabsTrigger value="Webdav">Webdav</TabsTrigger>
        </TabsList>
        <TabsContent value="Github">
          <GithubSync />
        </TabsContent>
        <TabsContent value="Gitee">
          <GiteeSync />
        </TabsContent>
        <TabsContent value="Webdav">
          <WebdavSync />
        </TabsContent>
      </Tabs>
    </SettingType>
  )
}
