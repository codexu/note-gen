'use client'

import { MobileEditor } from './mobile-editor'
import { WritingHeader } from './custom-header'
import useArticleStore from '@/stores/article'
import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

export default function Writing() {
  const { initCollapsibleList } = useArticleStore()
  const [editor, setEditor] = useState<Editor | null>(null)

  useEffect(() => {
    initCollapsibleList()
  }, [initCollapsibleList])

  return (
    <div id="mobile-writing" className='w-full h-full flex flex-col'>
      <WritingHeader editor={editor} />
      <div className='flex-1 overflow-hidden'>
        <MobileEditor onEditorReady={setEditor} />
      </div>
    </div>
  )
}
