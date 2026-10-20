'use client';
import { Eye, ImageIcon } from "lucide-react"
import { useTranslations } from 'next-intl';
import { SettingType } from '../components/setting-base';
import { OcrSetting } from "./ocr";
import { VlmSetting } from "./vlm";
import useSettingStore from "@/stores/setting";
import { Switch } from "@/components/ui/switch";
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';

export default function ImageMethod() {
  const t = useTranslations('settings.imageMethod');
  const { enableImageRecognition, setEnableImageRecognition } = useSettingStore()
  
  return (
    <SettingType id="imageMethod" icon={<ImageIcon />} title={t('title')} desc={t('desc')}>
      <div className="space-y-4">
        <Item variant="outline">
          <ItemMedia variant="icon"><Eye className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('enable.title')}</ItemTitle>
            <ItemDescription>{t('enable.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions className="mobile-setting-inline-action">
            <Switch
              checked={enableImageRecognition}
              onCheckedChange={setEnableImageRecognition}
            />
          </ItemActions>
        </Item>
        <OcrSetting />
        <VlmSetting />
      </div>
    </SettingType>
  )
}
