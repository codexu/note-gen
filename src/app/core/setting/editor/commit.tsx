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
import { GitCommit } from 'lucide-react'
import { ModelSelect } from '../components/model-select'

export default function Commit() {
  const t = useTranslations('settings.editor.commit')

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <GitCommit className="size-4" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('model.title')}</ItemTitle>
        <ItemDescription>{t('model.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <ModelSelect modelKey="commit" />
      </ItemActions>
    </Item>
  )
}
