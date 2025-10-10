import { Chat } from "@/db/chats";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Brain, ChevronDown, ChevronUp, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ChatThinking({chat}: { chat: Chat }) {
  const t = useTranslations()
  const [isThinkOpen, setIsThinkOpen] = useState(true)
  const thinkingContent = chat.content?.split('<thinking>')[1] || ''
  const content = chat.content?.includes('thinking') ? chat.content.split('<thinking>')[2] : chat.content
  
  return (
    chat.content?.includes('<thinking>') && <Card className="p-3 bg-muted/30 mb-4">
      <div className="space-y-2">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <span className="ml-auto">
              {content ? <Brain className="size-4" /> : <LoaderCircle className="animate-spin size-4" />}
            </span>
            <span className="font-bold">{t('ai.thinking')}</span>
          </h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsThinkOpen(!isThinkOpen)}
            className="h-6 w-6 p-0"
          >
            {isThinkOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>

        {/* 展开内容 */}
        {isThinkOpen && (
          <div className="pt-2">
            <p className='text-justify text-muted-foreground'>{thinkingContent}</p>
          </div>
        )}
      </div>
    </Card>
  )
}