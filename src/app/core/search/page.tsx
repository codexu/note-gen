'use client'
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import useArticleStore from "@/stores/article";
import { SearchResult } from './types'
import { SearchItem } from "./search-item";
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Search } from "lucide-react";
import { useTranslations } from 'next-intl';
import { RustFuzzySearch, FuzzySearchResult } from '@/lib/fuzzy-search';

dayjs.extend(relativeTime)

const searchList: Partial<SearchResult>[] = []
export default function Page() {
  const t = useTranslations();
  const [searchValue, setSearchValue] = useState('')
  const [searchResult, setSearchResult] = useState<FuzzySearchResult[]>([])
  const { allArticle, loadAllArticle } = useArticleStore()

  async function search(value: string) {
    if (!value) {
      setSearchResult([]);
      return;
    }
    
    const fuzzySearch = new RustFuzzySearch(searchList, {
      keys: ['desc', 'article', 'title', 'path'],
      includeMatches: true,
      includeScore: true,
      threshold: 0.3,
    });
    
    try {
      const res = await fuzzySearch.searchParallel(value);
      setSearchResult(res);
    } catch (error) {
      console.error('Error during search:', error);
      setSearchResult([]);
    }
  }

  async function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setSearchValue(value);
    await search(value);
  }
  async function initSearch() {
    await loadAllArticle()
  }

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
    searchList.push(...articles)
  }

  useEffect(() => {
    initSearch()
  }, [])

  useEffect(() => {
    searchList.length = 0
    setSearchData()
  }, [allArticle])

  return <div className="h-screen flex flex-col justify-center items-center overflow-y-auto">
    <div className={`${searchValue ? 'border-b' : ''} w-full h-20 flex justify-center items-center`}>
      <div className="relative">
        <Input
          type="text"
          value={searchValue}
          onChange={(e) => handleSearch(e)}
          className="w-[560px] mx-auto pl-8 pr-24"
          placeholder={t('search.placeholder')}
        />
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 select-none opacity-50" />
        {
          searchResult.length ? 
          <p className="absolute right-2 top-1/2 text-xs -translate-y-1/2 select-none opacity-50">{t('search.results', {count: searchResult.length})}</p> : null
        }
      </div>
    </div>
    {
      searchValue ?
      <div className="flex-1 w-full overflow-y-auto">
        {
          searchResult.length === 0 && searchValue ? 
          <div className="text-center mt-12 text-gray-400 text-sm">{t('search.noResults')}</div> :
          searchResult.map((item: FuzzySearchResult) => {
            return <SearchItem key={item.refIndex} item={item} />
          })
        }
      </div> :
      null
    }
  </div>
}
