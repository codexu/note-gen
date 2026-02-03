import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { ModelSelect } from "../components/model-select";
import { Bot, Highlighter, Zap, GitCommit } from "lucide-react";

export function Setting() {
  const t = useTranslations('settings.defaultModel');

  const options = [
    {
      title: t('options.primaryModel.title'),
      desc: t('options.primaryModel.desc'),
      modelKey: 'primaryModel',
      icon: <Bot className="size-4" />
    },
    {
      title: t('options.completion.title'),
      desc: t('options.completion.desc'),
      modelKey: 'completion',
      icon: <Zap className="size-4" />
    },
    {
      title: t('options.markDesc.title'),
      desc: t('options.markDesc.desc'),
      modelKey: 'markDesc',
      icon: <Highlighter className="size-4" />
    },
    {
      title: t('options.commit.title'),
      desc: t('options.commit.desc'),
      modelKey: 'commit',
      icon: <GitCommit className="size-4" />
    },
  ]

  return (
    <ItemGroup className="gap-4">
      {options.map((option) => (
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
      ))}
    </ItemGroup>
  )
}