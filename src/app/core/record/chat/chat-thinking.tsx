import { Chat } from "@/db/chats";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from '@/components/ui/button'
import { Brain, ChevronsUpDown, LoaderCircle } from 'lucide-react'
import { useTranslations } from "next-intl";


export default function ChatThinking({chat}: { chat: Chat }) {
  const t = useTranslations()
  const [isThinkOpen, setIsThinkOpen] = useState(true)
  const thinkingContent = chat.content?.split('<thinking>')[1] || ''
  const content = chat.content?.includes('thinking') ? chat.content.split('<thinking>')[2] : chat.content
  
  return (
    chat.content?.includes('<thinking>') && <Collapsible
      open={isThinkOpen}
      onOpenChange={setIsThinkOpen}
      className="w-full border rounded-lg p-4 mb-4"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <span className="ml-auto">
            {content ? <Brain className="size-4" /> : <LoaderCircle className="animate-spin size-4" />}
          </span>
          <span className="font-bold">{t('ai.thinking')}</span>
        </h4>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            <ChevronsUpDown className="h-4 w-4" />
            <span className="sr-only">Toggle</span>
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <p className='mt-2 text-justify text-muted-foreground'>{thinkingContent}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}