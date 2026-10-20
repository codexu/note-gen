'use client'
import ChatContent from '@/app/core/main/chat/chat-content'
import { ClipboardListener } from '@/app/core/main/chat/clipboard-listener'
import { ChatInput } from '@/app/core/main/chat/chat-input'
import { MobileChatHeader } from './components/mobile-chat-header'

export default function Chat() {
  return (
    <div id="mobile-chat" className="flex min-h-0 flex-1 flex-col w-full overflow-hidden">
      <MobileChatHeader />
      <ChatContent />
      <ClipboardListener />
      <div className="mobile-chat-input-wrapper shrink-0 px-1 pb-1">
        <ChatInput />
      </div>
    </div>
  )
}
