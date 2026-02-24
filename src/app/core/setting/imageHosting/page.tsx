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
import PicgoImageHosting from "./picgo";
import { S3ImageHosting } from "./s3";
import { SettingSwitch } from "./setting-switch";

export default function ImageHostingPage() {
  const t = useTranslations();
  const { mainImageHosting, setMainImageHosting } = useImageStore()

  // 使用 mainImageHosting 作为受控值
  const currentValue = mainImageHosting || 'github'

  const handleValueChange = async (value: string) => {
    await setMainImageHosting(value)
  }

  useEffect(() => {
    // 初始化时从 store 加载
    const init = async () => {
      const store = await Store.load('store.json');
      const imageHosting = await store.get<string>('mainImageHosting')
      if (imageHosting) {
        await setMainImageHosting(imageHosting)
      }
    }
    init()
  }, [])
  
  return (
    <SettingType id="imageHosting" icon={<ImageUp />} title={t('settings.imageHosting.title')} desc={t('settings.imageHosting.desc')}>
      <SettingSwitch />
      <Tabs className="mt-4" value={currentValue} onValueChange={handleValueChange}>
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
          <TabsTrigger value="s3" className="flex items-center gap-2">
            S3
            {mainImageHosting === 's3' && <SquareCheckBig className="size-4" />}
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
        <TabsContent value="s3">
          <S3ImageHosting />
        </TabsContent>
      </Tabs>
    </SettingType>
  )
}
