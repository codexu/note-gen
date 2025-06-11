'use client'
import ChatContent from '@/app/core/record/chat/chat-content'
import { ClipboardListener } from '@/app/core/record/chat/clipboard-listener'
import { ChatInput } from '@/app/core/record/chat/chat-input'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChatHeader } from '@/app/core/record/chat/chat-header'

export default function Chat() {
  return <TooltipProvider>
    <div className="flex flex-col h-full w-full">
      <ChatHeader />
      <ChatContent />
      <ClipboardListener />
      <ChatInput />
    </div>
  </TooltipProvider>
}