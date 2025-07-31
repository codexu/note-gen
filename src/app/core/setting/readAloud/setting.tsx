import { SettingPanel } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { ModelSelect } from "./model-select";
import { Volume2 } from "lucide-react";

export function Setting() {
  const t = useTranslations('settings.readAloud');

  const options = [
    {
      title: t('options.audioModel.title'),
      desc: t('options.audioModel.desc'),
      modelKey: 'audio',
      icon: <Volume2 className="size-4" />
    },
  ]

  return (
    options.map((option) => (
      <SettingPanel key={option.modelKey} title={option.title} desc={option.desc} icon={option.icon}>
        <ModelSelect />
      </SettingPanel>
    ))
  )
}
