import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { ModelSelect } from "../components/model-select";
import { Bot } from "lucide-react";
import { useTranslations } from 'next-intl';
import { SetDefault } from "./setDefault";

export function VlmSetting() {
  const t = useTranslations('settings.imageMethod.vlm')
  return (
    <>
      <Item variant="outline">
        <ItemMedia variant="icon"><Bot className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('title')}</ItemTitle>
          <ItemDescription>{t('desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ModelSelect modelKey={'imageMethod'} />
        </ItemActions>
      </Item>
      <SetDefault type="vlm" />
    </> 
  )
}