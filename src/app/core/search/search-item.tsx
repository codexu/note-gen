import { FuzzySearchResult } from '@/lib/fuzzy-search'
import { LocateFixed, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useRouter } from 'next/navigation'
import useArticleStore from '@/stores/article'
import { useTranslations } from 'next-intl'

function highlightMatches(inputString: string, matches: [number, number][]): string[] {
  const highlightedStringArray: string[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    const startIndex = match[0];
    const endIndex = match[1];
    highlightedStringArray.push(inputString.slice(lastIndex, startIndex));
    highlightedStringArray.push(`<i>${inputString.slice(startIndex, endIndex + 1)}</i>`);
    lastIndex = endIndex + 1;
  }
  highlightedStringArray.push(inputString.slice(lastIndex));
  return highlightedStringArray;
}

function SearchArticle({item}: {item: FuzzySearchResult}) {
  const t = useTranslations();
  const hightlightArticle = highlightMatches(item.item?.article || '', item.matches?.[0]?.indices || []).join('')

  const start = Math.max(item.matches?.[0]?.indices[0][0] - 50, 0);
  const end = Math.min(item.matches?.[0]?.indices[item.matches?.[0]?.indices.length - 1][1] + 200, hightlightArticle.length);

  return (
    <div className="flex gap-4 w-full">
      <div className='flex flex-col flex-1 justify-between'>
        <div className='flex gap-1 mb-2 items-center'>
          <RouteTo item={item} />
          <Badge>{t('search.item.article')}</Badge>
        </div>
        <div className='flex flex-col gap-1 flex-1 mb-4'>
          <div className='flex items-center gap-2'>
            <MapPin className='size-3' />
            <p className='text-sm overflow-hidden flex-1 search-highlight' dangerouslySetInnerHTML={{
              __html: hightlightArticle?.slice(start, end)
            }} />
          </div>
        </div>
        <div className='flex gap-1 items-center'>
          <Badge variant={'secondary'}>{t('search.item.matches', { count: item.matches?.[0].indices.length })}</Badge>
          <Badge variant={'secondary'}>{item.item.path}</Badge>
        </div>
      </div>
    </div>
  )
}

function RouteTo({ item }: { item: FuzzySearchResult}) {
  const { setActiveFilePath, setMatchPosition, setCollapsibleList } = useArticleStore()
  const router = useRouter()
  function handleRouterTo() {
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
  }
  return (
    <LocateFixed className='size-4 cursor-pointer mr-1 text-cyan-900' onClick={handleRouterTo} />
  )
}

export function SearchItem({
  item,
}: {
  item: FuzzySearchResult
}) {
  
  return (
    <div className="flex items-center justify-between p-4 border m-4 rounded overflow-hidden border-b-gray-200 dark:border-b-gray-700">
      <div className="flex items-center gap-2 w-full">
        <SearchArticle item={item} />
      </div>
    </div>
  ) 
}