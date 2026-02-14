'use client'

import { MobileEditor } from './mobile-editor'
import { WritingHeader } from './custom-header'
import useArticleStore from '@/stores/article'
import { useEffect } from 'react'

export default function Writing() {
  const { initCollapsibleList } = useArticleStore()

  useEffect(() => {
    initCollapsibleList()
  }, [initCollapsibleList])

  return (
    <div id="mobile-writing" className='w-full h-full flex flex-col'>
      <WritingHeader />
      <div className='flex-1 overflow-hidden'>
        <MobileEditor />
      </div>
    </div>
  )
}