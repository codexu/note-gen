import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item';
import { useTranslations } from 'next-intl';
import { ModelSelect } from "../components/model-select";
import { ChartScatter, ListOrdered } from "lucide-react";
import { Badge } from '@/components/ui/badge';
import useVectorStore from '@/stores/vector';
import useRagSettingsStore from '@/stores/ragSettings';
import { Store } from '@tauri-apps/plugin-store';
import { useEffect, useState } from 'react';

export function ModelSetting() {
  const t = useTranslations('settings.defaultModel');
  const ragT = useTranslations('settings.rag');
  const { hasEmbeddingModel, hasRerankModel, checkEmbeddingModel, checkRerankModel } = useVectorStore();
  const { markIndexDirty } = useRagSettingsStore();
  const [configuredModels, setConfiguredModels] = useState({ embedding: false, reranking: false });

  useEffect(() => {
    Store.load('store.json').then(async store => {
      const [embedding, reranking] = await Promise.all([
        store.get<string>('embeddingModel'),
        store.get<string>('rerankingModel')
      ]);
      setConfiguredModels({ embedding: Boolean(embedding), reranking: Boolean(reranking) });
      if (embedding) void checkEmbeddingModel();
      if (reranking) void checkRerankModel();
    });
  }, [checkEmbeddingModel, checkRerankModel]);

  async function handleModelChange(modelKey: string, model: string) {
    setConfiguredModels(current => ({ ...current, [modelKey]: Boolean(model) }));
    if (modelKey === 'embedding') {
      await markIndexDirty();
      if (model) {
        await checkEmbeddingModel();
      } else {
        useVectorStore.setState({ hasEmbeddingModel: false });
      }
    } else {
      if (model) {
        await checkRerankModel();
      } else {
        useVectorStore.setState({ hasRerankModel: false });
      }
    }
  }
  
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
          <Item
            key={option.modelKey}
            className="max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:items-start"
            variant="outline"
          >
            <ItemMedia variant="icon">{option.icon}</ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="max-w-full min-w-0">
                <span className="truncate">{option.title}</span>
                <Badge variant={option.modelKey === 'embedding' ? (hasEmbeddingModel ? 'secondary' : 'outline') : (hasRerankModel ? 'secondary' : 'outline')}>
                  {option.modelKey === 'embedding'
                    ? (hasEmbeddingModel ? ragT('modelAvailable') : configuredModels.embedding ? ragT('modelUnavailable') : ragT('modelNotConfigured'))
                    : (hasRerankModel ? ragT('modelAvailable') : configuredModels.reranking ? ragT('modelUnavailable') : ragT('modelNotConfigured'))}
                </Badge>
              </ItemTitle>
              <ItemDescription>{option.desc}</ItemDescription>
            </ItemContent>
            <ItemActions className="max-md:col-span-2 max-md:w-full">
              <ModelSelect modelKey={option.modelKey} onValueChange={model => handleModelChange(option.modelKey, model)} />
            </ItemActions>
          </Item>
        ))
      }
    </ItemGroup>
  )
}
