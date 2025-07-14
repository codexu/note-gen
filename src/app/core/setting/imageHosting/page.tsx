'use client';
import { ImageUp, SquareCheckBig } from "lucide-react"
import { useTranslations } from 'next-intl';
import { SettingType } from '../components/setting-base';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GithubImageHosting } from "./github";
import SMMSImageHosting from "./smms";
import useImageStore from "@/stores/imageHosting";
import { useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";

export default function ImageHostingPage() {
  const t = useTranslations();
  const { mainImageHosting, setMainImageHosting } = useImageStore()

  async function init() {
    const store = await Store.load('store.json');
    const imageHosting = await store.get<string>('mainImageHosting')
    if (imageHosting) {
      setMainImageHosting(imageHosting)
    }
  }

  useEffect(() => {
    init()
  }, [])
  
  return (
    <SettingType id="imageHosting" icon={<ImageUp />} title={t('settings.imageHosting.title')} desc={t('settings.imageHosting.desc')}>
      <Tabs defaultValue={mainImageHosting}>
        <TabsList className="grid grid-cols-2 w-full mb-8">
          <TabsTrigger value="github" className="flex items-center gap-2">
            Github
            {mainImageHosting === 'github' && <SquareCheckBig className="size-4" />}
          </TabsTrigger>
          <TabsTrigger value="smms" className="flex items-center gap-2">
            SM.MS
            {mainImageHosting === 'smms' && <SquareCheckBig className="size-4" />}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="github">
          <GithubImageHosting />
        </TabsContent>
        <TabsContent value="smms">
          <SMMSImageHosting />
        </TabsContent>
      </Tabs>
    </SettingType>
  )
}
