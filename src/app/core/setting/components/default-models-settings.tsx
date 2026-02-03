'use client'

import { useTranslations } from 'next-intl'
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from '@/components/ui/item'
import { BotMessageSquare, PenTool, Zap, GitCommit, FileText, Lightbulb } from 'lucide-react'
import { ModelSelect } from './model-select'

interface DefaultModelsSettingsProps {
  type: 'chat' | 'editor' | 'record'
}

export function DefaultModelsSettings({ type }: DefaultModelsSettingsProps) {
  const t = useTranslations('settings')

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t('defaultModels.title')}</h3>

      {/* Chat - Primary Model */}
      {type === 'chat' && (
        <>
          <Item variant="outline">
            <ItemMedia variant="icon">
              <BotMessageSquare className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('chat.primaryModel.model.title')}</ItemTitle>
              <ItemDescription>{t('chat.primaryModel.model.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey="primaryModel" />
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon">
              <FileText className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('chat.condense.model.title')}</ItemTitle>
              <ItemDescription>{t('chat.condense.model.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey="condense" />
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon">
              <Lightbulb className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('chat.inspiration.model.title')}</ItemTitle>
              <ItemDescription>{t('chat.inspiration.model.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey="inspiration" />
            </ItemActions>
          </Item>
        </>
      )}

      {/* Record - MarkDesc */}
      {type === 'record' && (
        <Item variant="outline">
          <ItemMedia variant="icon">
            <PenTool className="size-4" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t('record.model.markDesc.title')}</ItemTitle>
            <ItemDescription>{t('record.model.markDesc.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ModelSelect modelKey="markDesc" />
          </ItemActions>
        </Item>
      )}

      {/* Editor - Completion & Commit */}
      {type === 'editor' && (
        <>
          <Item variant="outline">
            <ItemMedia variant="icon">
              <GitCommit className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('editor.commit.model.title')}</ItemTitle>
              <ItemDescription>{t('editor.commit.model.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey="commit" />
            </ItemActions>
          </Item>
          <Item variant="outline">
            <ItemMedia variant="icon">
              <Zap className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('editor.completion.model.title')}</ItemTitle>
              <ItemDescription>{t('editor.completion.model.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey="completion" />
            </ItemActions>
          </Item>
        </>
      )}
    </div>
  )
}
