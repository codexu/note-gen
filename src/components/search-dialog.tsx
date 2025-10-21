'use client'

import { useEffect, useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
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
import { RustFuzzySearch, FuzzySearchResult } from '@/lib/fuzzy-search'
import { useRouter } from 'next/navigation'

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SearchResult {
  id: string
  path?: string
  article?: string
  desc?: string
  title?: string
  searchType?: string
}

function highlightMatches(inputString: string, matches: [number, number][]): string[] {
  const highlightedStringArray: string[] = []
  let lastIndex = 0
  for (const match of matches) {
    const startIndex = match[0]
    const endIndex = match[1]
    highlightedStringArray.push(inputString.slice(lastIndex, startIndex))
    highlightedStringArray.push(`<mark class="bg-yellow-200 dark:bg-yellow-800">${inputString.slice(startIndex, endIndex + 1)}</mark>`)
    lastIndex = endIndex + 1
  }
  highlightedStringArray.push(inputString.slice(lastIndex))
  return highlightedStringArray
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const t = useTranslations()
  const router = useRouter()
  const [searchValue, setSearchValue] = useState('')
  const [searchResult, setSearchResult] = useState<FuzzySearchResult[]>([])
  const { allArticle, loadAllArticle, setActiveFilePath, setMatchPosition, setCollapsibleList } = useArticleStore()
  const [searchList, setSearchList] = useState<Partial<SearchResult>[]>([])

  function extractTitleFromPath(path: string): string {
    if (!path) return ''
    const parts = path.split(/[\/\\]/)
    const fileName = parts[parts.length - 1]
    return fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
  }

  function setSearchData() {
    const articles = allArticle.map((item, index) => {
      const title = extractTitleFromPath(item.path || '')
      return {
        ...item,
        searchType: 'article',
        title,
        id: `article-${index}-${item.path?.replace(/[^a-zA-Z0-9]/g, '-')}`,
        path: item.path
      }
    })
    setSearchList(articles)
  }

  async function search(value: string) {
    if (!value) {
      setSearchResult([])
      return
    }
    
    const fuzzySearch = new RustFuzzySearch(searchList, {
      keys: ['desc', 'article', 'title', 'path'],
      includeMatches: true,
      includeScore: true,
      threshold: 0.3,
    })
    
    try {
      const res = await fuzzySearch.searchParallel(value)
      setSearchResult(res)
    } catch (error) {
      console.error('Error during search:', error)
      setSearchResult([])
    }
  }

  async function handleSelect(item: FuzzySearchResult) {
    if (item.matches && item.matches.length > 0 && item.matches[0].indices.length > 0) {
      const matchPosition = item.matches[0].indices[0][0]
      setMatchPosition(matchPosition)
    }
    
    const filePath = item.item.path as string
    
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
      
      onOpenChange(false)
      router.push(`/core/article`)
    }
    
    setupAndNavigate()
  }

  useEffect(() => {
    if (open) {
      loadAllArticle()
    }
  }, [open])

  useEffect(() => {
    setSearchData()
  }, [allArticle])

  useEffect(() => {
    search(searchValue)
  }, [searchValue, searchList])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput 
        placeholder={t('search.placeholder')} 
        value={searchValue}
        onValueChange={setSearchValue}
      />
      <CommandList className="h-[400px] max-h-[400px]">
        <CommandEmpty>
          <Empty className="border-0">
            <EmptyHeader>
              <SearchX className="size-10 text-muted-foreground" />
              <EmptyTitle>{t('search.noResults')}</EmptyTitle>
              <EmptyDescription>
                {t('search.tryDifferentKeywords')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CommandEmpty>
        {searchResult.length > 0 && (
          <CommandGroup heading={t('search.results', { count: searchResult.length })}>
            {searchResult.map((item: FuzzySearchResult) => {
              const hightlightArticle = highlightMatches(
                item.item?.article || '', 
                item.matches?.[0]?.indices || []
              ).join('')
              
              const start = Math.max(item.matches?.[0]?.indices[0][0] - 50, 0)
              const end = Math.min(
                item.matches?.[0]?.indices[item.matches?.[0]?.indices.length - 1][1] + 200, 
                hightlightArticle.length
              )

              return (
                <CommandItem
                  key={item.refIndex}
                  value={`${item.item.path}-${item.refIndex}`}
                  onSelect={() => handleSelect(item)}
                  className="flex flex-col items-start gap-1.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <LocateFixed className="size-3.5 text-cyan-900 dark:text-cyan-400 shrink-0" />
                      <Badge variant="secondary" className="text-xs">{t('search.item.article')}</Badge>
                      <Badge variant="outline" className="text-xs">
                        {t('search.item.matches', { count: item.matches?.[0].indices.length })}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {item.item.path}
                    </div>
                  </div>
                  <div 
                    className="text-xs text-muted-foreground line-clamp-2 w-full"
                    dangerouslySetInnerHTML={{
                      __html: hightlightArticle?.slice(start, end)
                    }} 
                  />
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
