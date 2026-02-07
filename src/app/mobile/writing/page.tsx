'use client'

import { MdEditor } from '@/app/core/main/editor/markdown/md-editor-wrapper'
import { WritingHeader } from './custom-header'
import useArticleStore from '@/stores/article'
import { useEffect, useRef } from 'react'

export default function Writing() {
  const { initCollapsibleList } = useArticleStore()
  const tabContentsRef = useRef<Record<string, string>>({})

  useEffect(() => {
    // 初始化并恢复上次打开的文章
    initCollapsibleList()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div id="mobile-writing" className='w-full flex flex-col flex-1'>
      <WritingHeader />
      <div className='flex-1 overflow-hidden'>
        <MdEditor tabContentsRef={tabContentsRef} filePath="" />
      </div>
    </div>
  )
}