'use client'
import ChatContent from '@/app/core/record/chat/chat-content'
import { ClipboardListener } from '@/app/core/record/chat/clipboard-listener'
import { ChatInput } from '@/app/core/record/chat/chat-input'
import { ChatHeader } from '@/app/core/record/chat/chat-header'

export default function Chat() {
  return (
    <div className="flex flex-col h-[calc(100vh-128px)] w-full overflow-x-hidden">
      <ChatHeader />  
      <ChatContent />
      <ClipboardListener />
      <ChatInput />
    </div>
  )
}