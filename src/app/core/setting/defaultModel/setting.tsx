import { FormItem, SettingRow, SettingType } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import { ModelSelect } from "./model-select";
import useSettingStore from "@/stores/setting";

export function Setting({id, icon}: {id: string, icon?: React.ReactNode}) {
  const t = useTranslations('settings.defaultModel');
  const { model, aiType } = useSettingStore()

  const options = [
    {
      title: t('options.markDesc.title'),
      desc: t('options.markDesc.desc'),
      modelKey: 'markDesc'
    },
    {
      title: t('options.placeholder.title'),
      desc: t('options.placeholder.desc'),
      modelKey: 'placeholder'
    },
    {
      title: t('options.translate.title'),
      desc: t('options.translate.desc'),
      modelKey: 'translate'
    },
    {
      title: t('options.embedding.title'),
      desc: t('options.embedding.desc'),
      modelKey: 'embedding'
    },
    {
      title: t('options.reranking.title'),
      desc: t('options.reranking.desc'),
      modelKey: 'reranking'
    },
  ]

  return (
    <SettingType id={id} icon={icon} title={t('title')} desc={t('desc')}>
      <SettingRow>
        <FormItem title={t('mainModel')}>
          <p>{`${model}(${aiType})`}</p>
        </FormItem>
      </SettingRow>
      {options.map((option) => (
        <SettingRow key={option.modelKey}>
          <FormItem title={option.title} desc={option.desc}>
            <ModelSelect modelKey={option.modelKey} />
          </FormItem>
        </SettingRow>
      ))}
    </SettingType>
  )
}