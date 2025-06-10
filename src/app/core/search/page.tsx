'use client'
import { Input } from "@/components/ui/input";
import useMarkStore from "@/stores/mark";
import { useEffect, useState } from "react";
import Fuse, { FuseResult } from "fuse.js";
import useArticleStore from "@/stores/article";
import { SearchResult } from './types'
import { SearchItem } from "./search-item";
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Search } from "lucide-react";

dayjs.extend(relativeTime)

const searchList: Partial<SearchResult>[] = []
export default function Page() {
  const [searchValue, setSearchValue] = useState('')
  const { fetchAllMarks, allMarks } = useMarkStore()
  const [searchResult, setSearchResult] = useState<FuseResult<Partial<SearchResult>>[]>([])
  const { allArticle, loadAllArticle } = useArticleStore()

  function search(value: string) {
    const fuse = new Fuse(searchList, {
      keys: ['desc', 'article', 'title'],
      includeMatches: true,
      includeScore: true,
      threshold: 0.3,
    })
    const res = fuse.search(value).reverse()
    setSearchResult(res)
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchValue(e.target.value)
    search(e.target.value)
  }
  async function initSearch() {
    await fetchAllMarks()
    await loadAllArticle()
  }

  function extractTitleFromPath(path: string): string {
    if (!path) return ''
    const parts = path.split(/[\/\\]/)
    const fileName = parts[parts.length - 1]
    return fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
  }

  function setSearchData() {
    const marks = allMarks.map(item => ({...item, searchType: 'mark'}))
    searchList.push(...marks)
    const articles = allArticle.map(item => {
      const title = extractTitleFromPath(item.path || '')
      return {...item, searchType: 'article', title}
    })
    searchList.push(...articles)
    console.log('searchList', searchList)
  }

  useEffect(() => {
    initSearch()
  }, [])

  useEffect(() => {
    searchList.length = 0
    setSearchData()
  }, [allArticle, allMarks])

  return <div className="h-screen flex flex-col justify-center items-center overflow-y-auto">
    <div className={`${searchValue ? 'border-b' : ''} w-full h-20 flex justify-center items-center`}>
      <div className="relative">
        <Input
          type="text"
          value={searchValue}
          onChange={(e) => handleSearch(e)}
          className="w-[560px] mx-auto pl-8 pr-24"
          placeholder="搜索笔记和文章..."
        />
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 select-none opacity-50" />
        {
          searchResult.length ? 
          <p className="absolute right-2 top-1/2 text-xs -translate-y-1/2 select-none opacity-50">{searchResult.length} 个搜索结果</p> : null
        }
      </div>
    </div>
    {
      searchValue ?
      <div className="flex-1 w-full overflow-y-auto">
        {
          searchResult.length === 0 && searchValue ? 
          <div className="text-center mt-12 text-gray-400 text-sm">暂无搜索结果</div> :
          searchResult.map((item: FuseResult<Partial<SearchResult>>) => {
            return <SearchItem key={item.refIndex} item={item} />
          })
        }
      </div> :
      null
    }
  </div>
}