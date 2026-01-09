'use client'
import ChatContent from '@/app/core/record/chat/chat-content'
import { ClipboardListener } from '@/app/core/record/chat/clipboard-listener'
import { ChatInput } from '@/app/core/record/chat/chat-input'

export default function Chat() {
  return (
    <div id="mobile-chat" className="flex flex-col flex-1 w-full">
      <ChatContent />
      <ClipboardListener />
      <div className="px-1 pb-1">
        <ChatInput />
      </div>
    </div>
  )
}