'use client';
import { ImageUp } from "lucide-react"
import { useTranslations } from 'next-intl';
import { SettingType } from '../components/setting-base';
import { GithubImageHosting } from "./github";
import SMMSImageHosting from "./smms";
import useImageStore from "@/stores/imageHosting";
import { useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import PicgoImageHosting from "./picgo";
import { S3ImageHosting } from "./s3";
import { SettingSwitch } from "./setting-switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useSettingStore from "@/stores/setting"
import { getNormalizedImageHosting } from "@/lib/image-hosting-config"

export default function ImageHostingPage() {
  const t = useTranslations();
  const { mainImageHosting, setMainImageHosting } = useImageStore()
  const { useImageRepo } = useSettingStore()
  const normalizedImageHosting = getNormalizedImageHosting(mainImageHosting)

  // 使用真实存在且已归一化的图床值作为受控值
  const currentValue = normalizedImageHosting.value

  const handleValueChange = async (value: string) => {
    await setMainImageHosting(value)
  }

  useEffect(() => {
    // 初始化时从 store 加载
    const init = async () => {
      const store = await Store.load('store.json');
      const imageHosting = await store.get<string>('mainImageHosting')
      const normalized = getNormalizedImageHosting(imageHosting)
      await setMainImageHosting(normalized.value)
      if (normalized.shouldPersist) {
        await store.set('mainImageHosting', normalized.value)
        await store.save()
      }
    }
    init()
  }, [])

  return (
    <SettingType id="imageHosting" icon={<ImageUp />} title={t('settings.imageHosting.title')} desc={t('settings.imageHosting.desc')}>
      <SettingSwitch />
      {useImageRepo && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">{t('settings.imageHosting.type')}</label>
          <Select value={currentValue} onValueChange={handleValueChange}>
            <SelectTrigger className="w-45">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="github">Github</SelectItem>
              <SelectItem value="smms">S.EE</SelectItem>
              <SelectItem value="picgo">PicGo</SelectItem>
              <SelectItem value="s3">S3</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {useImageRepo && currentValue === 'github' && (
        <GithubImageHosting />
      )}
      {useImageRepo && currentValue === 'smms' && (
        <SMMSImageHosting />
      )}
      {useImageRepo && currentValue === 'picgo' && (
        <PicgoImageHosting />
      )}
      {useImageRepo && currentValue === 's3' && (
        <S3ImageHosting />
      )}
    </SettingType>
  )
}
