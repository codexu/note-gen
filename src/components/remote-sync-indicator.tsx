'use client'

import { Cloud, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import useArticleStore from '@/stores/article'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export function RemoteSyncIndicator() {
  const { remoteSyncLoading, activeFilePath } = useArticleStore()
  const [isVisible, setIsVisible] = useState(false)
  const t = useTranslations('article.sync')

  useEffect(() => {
    if (remoteSyncLoading) {
      setIsVisible(true)
    } else {
      // 延迟隐藏，让用户看到完成状态
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [remoteSyncLoading])

  // 如果没有活动文件或不可见，不显示
  if (!activeFilePath || !isVisible) {
    return null
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg shadow-lg transition-all duration-300',
        remoteSyncLoading ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      )}
    >
      {remoteSyncLoading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          <span className="text-sm text-muted-foreground">
            {t('syncingRemote')}
          </span>
        </>
      ) : (
        <>
          <Cloud className="h-4 w-4 text-green-500" />
          <span className="text-sm text-muted-foreground">
            {t('syncComplete')}
          </span>
        </>
      )}
    </div>
  )
}
