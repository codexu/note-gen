import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
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

  return (
    <ItemGroup className="gap-4">
      {
        modelOptions.map((option) => (
          <Item key={option.modelKey} variant="outline">
            <ItemMedia variant="icon">{option.icon}</ItemMedia>
            <ItemContent>
              <ItemTitle>{option.title}</ItemTitle>
              <ItemDescription>{option.desc}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey={option.modelKey} />
            </ItemActions>
          </Item>
        ))
      }
    </ItemGroup>
  )
}