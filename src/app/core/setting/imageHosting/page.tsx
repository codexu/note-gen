'use client';
import { ImageUp, SquareCheckBig } from "lucide-react"
import { useTranslations } from 'next-intl';
import { SettingType } from '../components/setting-base';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GithubImageHosting } from "./github";
import SMMSImageHosting from "./smms";
import useImageStore from "@/stores/imageHosting";
import { useEffect, useState } from "react";
import { Store } from "@tauri-apps/plugin-store";
import PicgoImageHosting from "./picgo";
import { SettingSwitch } from "./setting-switch";

export default function ImageHostingPage() {
  const t = useTranslations();
  const { mainImageHosting, setMainImageHosting } = useImageStore()
  const [value, setValue] = useState(mainImageHosting)

  async function init() {
    const store = await Store.load('store.json');
    const imageHosting = await store.get<string>('mainImageHosting')
    if (imageHosting) {
      setMainImageHosting(imageHosting)
      setValue(imageHosting)
    }
  }

  useEffect(() => {
    init()
  }, [])
  
  return (
    <SettingType id="imageHosting" icon={<ImageUp />} title={t('settings.imageHosting.title')} desc={t('settings.imageHosting.desc')}>
      <SettingSwitch />
      <Tabs className="mt-4" value={value} defaultValue={mainImageHosting} onValueChange={(value) => {setValue(value)}}>
        <TabsList className="grid grid-cols-4 w-full mb-8">
          <TabsTrigger value="github" className="flex items-center gap-2">
            Github
            {mainImageHosting === 'github' && <SquareCheckBig className="size-4" />}
          </TabsTrigger>
          <TabsTrigger value="smms" className="flex items-center gap-2">
            SM.MS
            {mainImageHosting === 'smms' && <SquareCheckBig className="size-4" />}
          </TabsTrigger>
          <TabsTrigger value="picgo" className="flex items-center gap-2">
            PicGo
            {mainImageHosting === 'picgo' && <SquareCheckBig className="size-4" />}
          </TabsTrigger>
          <TabsTrigger value="none" disabled>
            Under development...
          </TabsTrigger>
        </TabsList>
        <TabsContent value="github">
          <GithubImageHosting />
        </TabsContent>
        <TabsContent value="smms">
          <SMMSImageHosting />
        </TabsContent>
        <TabsContent value="picgo">
          <PicgoImageHosting />
        </TabsContent>
      </Tabs>
    </SettingType>
  )
}
