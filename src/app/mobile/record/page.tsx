'use client'
import { useEffect } from 'react'
import { MobileRecordStream } from './mobile-record-stream'
import useChatStore from '@/stores/chat'
import useMarkStore from '@/stores/mark'

export default function Record() {
  const clearActiveMark = useMarkStore(state => state.clearActiveMark)

  useEffect(() => {
    clearActiveMark()
    useChatStore.getState().setMobileActiveContexts({ markId: null })
  }, [clearActiveMark])

  return (
    <div id="mobile-record" className="flex h-full min-h-0 w-full flex-col bg-background">
      <MobileRecordStream />
    </div>
  )
}
