import useSettingStore from "@/stores/setting"
import { SettingPanel } from "../components/setting-base"
import { Switch } from "@/components/ui/switch"
import { useTranslations } from 'next-intl';

export function SettingSwitch() {
  const t = useTranslations('settings.sync')
  const {
    useImageRepo,
    setUseImageRepo,
  } = useSettingStore()
  return (
    <SettingPanel title={t('imageRepoSetting')} desc={t('imageRepoSettingDesc')}>
      <Switch 
        checked={useImageRepo} 
        onCheckedChange={(checked) => setUseImageRepo(checked)} 
      />
    </SettingPanel>
  )
}