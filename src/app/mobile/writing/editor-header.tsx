'use client'

import { ChevronLeft, List, SearchCode } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import emitter from '@/lib/emitter'
import useArticleStore from '@/stores/article'

interface EditorHeaderProps {
  onBack: () => void | Promise<void>
}

export function EditorHeader({ onBack }: EditorHeaderProps) {
  const tEditor = useTranslations('article.editor')
  const tMobile = useTranslations('article.file.mobile')
  const tOutline = useTranslations('editor.outline')
  const activeFilePath = useArticleStore(state => state.activeFilePath)
  const fileName = activeFilePath.split('/').pop() || tMobile('editor')

  return (
    <header className="mobile-page-header flex w-full shrink-0 items-center gap-2 border-b bg-background px-2 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onBack}
          aria-label={tMobile('backToFiles')}
        >
          <ChevronLeft />
        </Button>
        <div className="min-w-0 flex-1 truncate font-medium" title={fileName}>
          {fileName}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => emitter.emit('editor-search-trigger')}
          aria-label={tEditor('search.placeholder')}
        >
          <SearchCode />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => emitter.emit('mobile-editor-toggle-outline')}
          aria-label={tOutline('open')}
        >
          <List />
        </Button>
      </div>
    </header>
  )
}
