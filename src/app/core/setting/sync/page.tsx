'use client';
import { FileUp } from "lucide-react"
import { useTranslations } from 'next-intl';
import { GithubSync } from "./github-sync";
import { GiteeSync } from "./gitee-sync";
import { GitlabSync } from "./gitlab-sync";
import { GiteaSync } from "./gitea-sync";
import { SettingType } from '../components/setting-base';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SquareCheckBig } from "lucide-react"
import useSettingStore from "@/stores/setting";
import { useState } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { useEffect } from "react";

export default function SyncPage() {
  const t = useTranslations();
  const { primaryBackupMethod, setPrimaryBackupMethod } = useSettingStore()

  const tabs = ['github', 'gitee', 'gitlab', 'gitea']

  const [tab, setTab] = useState(primaryBackupMethod)

  async function init () {
    const store = await Store.load('store.json')
    const primaryBackupMethod = await store.get<'github' | 'gitee' | 'gitlab' | 'gitea'>('primaryBackupMethod')
    if (primaryBackupMethod) {
      setPrimaryBackupMethod(primaryBackupMethod)
      setTab(primaryBackupMethod)
    }
  }

  useEffect(() => {
    init()
  }, [])
  
  return (
    <SettingType id="sync" icon={<FileUp />} title={t('settings.sync.title')} desc={t('settings.sync.desc')}>
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'github' | 'gitee' | 'gitlab' | 'gitea')}>
        <TabsList className="grid grid-cols-4 w-full mb-8">
          {
            tabs.map((item) => (
              <TabsTrigger value={item} key={item} className="flex items-center gap-2">
                {item.charAt(0).toUpperCase() + item.slice(1)}
                {primaryBackupMethod === item && <SquareCheckBig className="size-4" />}
              </TabsTrigger>
            ))
          }
        </TabsList>
        <TabsContent value="github">
          <GithubSync />
        </TabsContent>
        <TabsContent value="gitee">
          <GiteeSync />
        </TabsContent>
        <TabsContent value="gitlab">
          <GitlabSync />
        </TabsContent>
        <TabsContent value="gitea">
          <GiteaSync />
        </TabsContent>
      </Tabs>
    </SettingType>
  )
}
