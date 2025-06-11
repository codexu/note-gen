'use client'

import { MdEditor } from '@/app/core/article/md-editor'
import { WritingHeader } from './custom-header'

export default function Writing() {
  return (
    <div className='w-full flex flex-col flex-1'>
      <WritingHeader />
      <div className='flex-1 overflow-hidden'>
        <MdEditor />
      </div>
    </div>
  )
}