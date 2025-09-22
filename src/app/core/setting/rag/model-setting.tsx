import { SettingPanel } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { ModelSelect } from "../components/model-select";
import { ChartScatter, ListOrdered } from "lucide-react";

export function ModelSetting() {
  const t = useTranslations('settings.defaultModel');
  
  const modelOptions = [
    {
      title: t('options.embedding.title'),
      desc: t('options.embedding.desc'),
      modelKey: 'embedding',
      icon: <ChartScatter className="size-4" />
    },
    {
      title: t('options.reranking.title'),
      desc: t('options.reranking.desc'),
      modelKey: 'reranking',
      icon: <ListOrdered className="size-4" />
    },
  ];

  return modelOptions.map((option) => (
    <SettingPanel 
      key={option.modelKey} 
      title={option.title} 
      desc={option.desc} 
      icon={option.icon}
    >
      <ModelSelect modelKey={option.modelKey} />
    </SettingPanel>
  ))
}