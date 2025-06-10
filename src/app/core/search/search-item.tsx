import { FuseResult, RangeTuple } from 'fuse.js'
import { SearchResult } from './types'
import { LocalImage } from '@/components/local-image'
import { LocateFixed, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import dayjs from 'dayjs'
import useTagStore from '@/stores/tag'
import { useRouter } from 'next/navigation'
import useArticleStore from '@/stores/article'
import { useTranslations } from 'next-intl'

function highlightMatches(inputString: string, matches: readonly RangeTuple[]): string[] {
  const highlightedStringArray: string[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    const startIndex = match[0];
    const endIndex = match[1];
    highlightedStringArray.push(inputString.slice(lastIndex, startIndex));
    highlightedStringArray.push(`<span class="search-highlight">${inputString.slice(startIndex, endIndex + 1)}</span>`);
    lastIndex = endIndex + 1;
  }
  highlightedStringArray.push(inputString.slice(lastIndex));
  return highlightedStringArray;
}

function SearchMark({
  item,
}: {
  item: FuseResult<Partial<SearchResult>>
}) {
  const t = useTranslations();
  const path = item.item?.type === 'scan' ? 'screenshot' : 'image'

  return (
    <div className="flex gap-4 w-full justify-between">
      <div className='flex flex-col justify-between'>
        <div className='flex gap-1 mb-2 items-center'>
          <RouteTo item={item} />
          <Badge>{t('search.item.record')}</Badge>
        </div>
        <p className='text-sm line-clamp-1 mb-4' dangerouslySetInnerHTML={
          {__html: highlightMatches(item.item?.desc || '', item.matches?.[0].indices || []).join('')}
        }>
        </p>
        <div className='flex gap-1'>
          <Badge variant={'secondary'}>{t('search.item.matches', { count: item.matches?.[0].indices.length })}</Badge>
          <Badge variant={'secondary'}>{item.item.type || t('search.item.scanType')}</Badge>
          <Badge variant={'secondary'}>{dayjs(item.item.createdAt).fromNow()}</Badge>
        </div>
      </div>
      {
        item.item?.type === 'text' ? null : (
          <LocalImage
            src={item.item?.url?.includes('http') ? item.item.url : `/${path}/${item.item.url}`}
            alt=""
            className="size-24 border object-cover"
          />
        )
      }
    </div>
  )
}

function SearchArticle({
  item,
}: {
  item: FuseResult<Partial<SearchResult>>
}) {
  const t = useTranslations();
  const hightlightArticle = highlightMatches(item.item?.article || '', item.matches?.[0].indices || []).join('')

  return (
    <div className="flex gap-4 w-full">
      <div className='flex flex-col flex-1 justify-between'>
        <div className='flex gap-1 mb-2 items-center'>
          <RouteTo item={item} />
          <Badge>{t('search.item.article')}</Badge>
        </div>
        <div className='flex flex-col gap-1 flex-1 mb-4'>
          {
            item.matches?.[0].indices.slice(0, 3).map((range, index) => {
              return <div key={index} className='flex items-center gap-2'>
                <MapPin className='size-3' />
                <p className='text-sm line-clamp-1 overflow-hidden flex-1' dangerouslySetInnerHTML={{
                  __html: hightlightArticle?.slice(Math.max(range[0] - 50 + index * 44, 0), range[1] + 180 + index * 44)
                }} />
              </div>
            })
          }
        </div>
        <div className='flex gap-1 items-center'>
          <Badge variant={'secondary'}>{t('search.item.matches', { count: item.matches?.[0].indices.length })}</Badge>
          <Badge variant={'secondary'}>{item.item.path}</Badge>
        </div>
      </div>
    </div>
  )
}

function SearchType({
  item,
}: {
  item: FuseResult<Partial<SearchResult>>
}) {

  switch (item.item.searchType) {
    case 'mark':
      return <SearchMark item={item} />
    default:
      return <SearchArticle item={item} />
  }
}

function RouteTo({
  item,
}: {
  item: FuseResult<Partial<SearchResult>>
}) {
  const { setCurrentTagId } = useTagStore()
  const { setActiveFilePath, setMatchPosition, setCollapsibleList } = useArticleStore()
  const router = useRouter()
  function handleRouterTo() {
    switch (item.item.searchType) {
      case 'mark':
        setCurrentTagId(item.item.tagId as number)
        router.push(`/core/note`)
        break;
      default:
        // 当匹配到文章时，设置匹配位置
        if (item.matches && item.matches.length > 0 && item.matches[0].indices.length > 0) {
          // 取第一个匹配项的起始位置
          const matchPosition = item.matches[0].indices[0][0]
          setMatchPosition(matchPosition)
        }
        
        // 设置当前文件路径
        const filePath = item.item.path as string
        
        // 使用Promise来确保所有状态更新和异步操作完成后再进行导航
        const setupAndNavigate = async () => {
          // 先设置活动文件路径
          setActiveFilePath(filePath)
          
          // 确保文件所在的所有父文件夹都被展开
          // 获取文件的父文件夹路径
          const pathParts = filePath.split('/')
          pathParts.pop() // 移除文件名，只保留文件夹路径
          
          // 逐级展开父文件夹
          let currentPath = ''
          for (const part of pathParts) {
            if (currentPath) {
              currentPath += '/' + part
            } else {
              currentPath = part
            }
            
            // 将文件夹添加到展开列表中
            if (currentPath) {
              await setCollapsibleList(currentPath, true)
            }
          }
          
          // 将文件路径保存到localStorage，这样文章页面可以检测到它
          localStorage.setItem('pendingReadArticle', filePath)
          
          // 导航到文章页面
          router.push(`/core/article`)
        }
        
        setupAndNavigate()
        break;
    }
  }
  return (
    <LocateFixed className='size-4 cursor-pointer mr-1 text-cyan-900' onClick={handleRouterTo} />
  )
}

export function SearchItem({
  item,
}: {
  item: FuseResult<Partial<SearchResult>>
}) {
  
  return (
    <div className="flex items-center justify-between p-4 border m-4 rounded overflow-hidden border-b-gray-200 dark:border-b-gray-700">
      <div className="flex items-center gap-2 w-full">
        <SearchType item={item} />
      </div>
    </div>
  ) 
}