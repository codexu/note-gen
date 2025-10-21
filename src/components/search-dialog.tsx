'use client'

import { useEffect, useState } from 'react'
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { LocateFixed, SearchX } from 'lucide-react'
import { useTranslations } from 'next-intl'
import useArticleStore from '@/stores/article'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import { useRouter } from 'next/navigation'
import emitter from '@/lib/emitter'
import { EmitterRecordEvents } from '@/config/emitters'

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SearchResult {
  id: string
  path?: string
  article?: string
  content?: string
  desc?: string
  title?: string
  searchType?: string
  tagId?: number
  tagName?: string
  type?: string
  url?: string
  matchText?: string
  matchIndices?: number[]
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const t = useTranslations()
  const router = useRouter()
  const [searchValue, setSearchValue] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult[]>([])
  const { allArticle, loadAllArticle, setActiveFilePath, setMatchPosition, setCollapsibleList } = useArticleStore()
  const { allMarks, fetchAllMarks } = useMarkStore()
  const { tags, fetchTags, setCurrentTagId } = useTagStore()

  function extractTitleFromPath(path: string): string {
    if (!path) return ''
    const parts = path.split(/[\/\\]/)
    const fileName = parts[parts.length - 1]
    return fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
  }

  function search(value: string) {
    if (!value.trim()) {
      setSearchResult([])
      return
    }
    
    const query = value.toLowerCase()
    const results: SearchResult[] = []
    
    // 搜索文章
    allArticle.forEach((item, index) => {
      const title = extractTitleFromPath(item.path || '')
      const searchText = `${title} ${item.article || ''} ${item.path || ''}`.toLowerCase()
      
      if (searchText.includes(query)) {
        const matchIndex = searchText.indexOf(query)
        results.push({
          id: `article-${index}-${item.path?.replace(/[^a-zA-Z0-9]/g, '-')}`,
          searchType: 'article',
          title,
          path: item.path,
          article: item.article,
          matchText: item.article,
          matchIndices: [matchIndex]
        })
      }
    })
    
    // 搜索记录
    allMarks.forEach((item, index) => {
      const tag = tags.find(tag => tag.id === item.tagId)
      const searchText = `${item.content || ''} ${item.desc || ''} ${tag?.name || ''}`.toLowerCase()
      
      if (searchText.includes(query)) {
        const matchIndex = searchText.indexOf(query)
        results.push({
          id: `mark-${index}-${item.id}`,
          searchType: 'record',
          content: item.content,
          article: item.content,
          title: item.desc || item.content?.slice(0, 50),
          path: tag?.name || 'Record',
          tagName: tag?.name,
          tagId: item.tagId,
          type: item.type,
          url: item.url,
          desc: item.desc,
          matchText: item.content,
          matchIndices: [matchIndex]
        })
      }
    })
    
    setSearchResult(results)
  }

  async function handleSelect(item: SearchResult) {
    // 如果是记录类型，跳转到记录页面并设置对应的 tag
    if (item.searchType === 'record') {
      onOpenChange(false)
      
      if (item.tagId) {
        await setCurrentTagId(item.tagId)
      }
      
      // 如果已经在记录页面，立即触发刷新事件
      if (window.location.pathname === '/core/record') {
        emitter.emit(EmitterRecordEvents.refreshMarks)
      } else {
        // 如果不在记录页面，先跳转，然后延迟触发事件（等待页面加载）
        router.push(`/core/record`)
        setTimeout(() => {
          emitter.emit(EmitterRecordEvents.refreshMarks)
        }, 500)
      }
      return
    }
    
    onOpenChange(false)
    
    // 如果是文章类型，跳转到文章页面
    if (item.matchIndices && item.matchIndices.length > 0) {
      setMatchPosition(item.matchIndices[0])
    }
    
    const filePath = item.path as string
    
    const setupAndNavigate = async () => {
      setActiveFilePath(filePath)
      
      const pathParts = filePath.split('/')
      pathParts.pop()
      
      let currentPath = ''
      for (const part of pathParts) {
        if (currentPath) {
          currentPath += '/' + part
        } else {
          currentPath = part
        }
        
        if (currentPath) {
          await setCollapsibleList(currentPath, true)
        }
      }
      
      localStorage.setItem('pendingReadArticle', filePath)
      
      router.push(`/core/article`)
    }
    
    setupAndNavigate()
  }

  useEffect(() => {
    if (open) {
      loadAllArticle()
      fetchAllMarks()
      fetchTags()
    }
  }, [open])

  useEffect(() => {
    search(searchValue)
  }, [searchValue, allArticle, allMarks, tags])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput 
        placeholder={t('search.placeholder')} 
        value={searchValue}
        onValueChange={setSearchValue}
      />
      <CommandList className="h-[400px] max-h-[400px]">
        {!searchValue && (
          <Empty className="border-0">
            <EmptyHeader>
              <SearchX className="size-10 text-muted-foreground" />
              <EmptyTitle>{t('search.placeholder')}</EmptyTitle>
              <EmptyDescription>
                {t('search.tryDifferentKeywords')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {searchResult.length === 0 && searchValue && (
          <Empty className="border-0">
            <EmptyHeader>
              <SearchX className="size-10 text-muted-foreground" />
              <EmptyTitle>{t('search.noResults')}</EmptyTitle>
              <EmptyDescription>
                {t('search.tryDifferentKeywords')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {searchResult.length > 0 && (
          <CommandGroup heading={t('search.results', { count: searchResult.length })}>
            {searchResult.map((item) => {
              const displayText = item.matchText || item.article || item.content || ''
              const matchIndex = item.matchIndices?.[0] || 0
              const start = Math.max(matchIndex - 50, 0)
              const end = Math.min(matchIndex + 200, displayText.length)
              const snippet = displayText.slice(start, end)

              return (
                <CommandItem
                  key={item.id}
                  value={`${item.searchType}-${item.title || item.path}`}
                  onSelect={() => handleSelect(item)}
                  className="flex flex-col items-start gap-1.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <LocateFixed className="size-3.5 text-cyan-900 dark:text-cyan-400 shrink-0" />
                      <Badge variant="secondary" className="text-xs">
                        {item.searchType === 'record' ? t('search.item.record') : t('search.item.article')}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {item.searchType === 'record' ? (item.tagName || t('search.item.record')) : item.path}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2 w-full">
                    {start > 0 && '...'}
                    {snippet}
                    {end < displayText.length && '...'}
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
