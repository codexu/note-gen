import useSettingStore from "@/stores/setting"
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Switch } from "@/components/ui/switch"
import { useTranslations } from 'next-intl';

export function SettingSwitch() {
  const t = useTranslations('settings.sync')
  const {
    useImageRepo,
    setUseImageRepo,
  } = useSettingStore()
  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t('imageRepoSetting')}</ItemTitle>
        <ItemDescription>{t('imageRepoSettingDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch 
          checked={useImageRepo} 
          onCheckedChange={(checked) => setUseImageRepo(checked)} 
        />
      </ItemActions>
    </Item>
  )
}