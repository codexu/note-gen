import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Chat } from "@/db/chats"
import dayjs from "dayjs"
import { Clock, TypeIcon } from "lucide-react"
import relativeTime from "dayjs/plugin/relativeTime"
import wordsCount from 'words-count'
import { useTranslations } from "next-intl"

dayjs.extend(relativeTime)

interface MessageInfoProps {
  chat: Chat
}

export function MessageInfo({ chat }: MessageInfoProps) {
  const t = useTranslations()
  const count = wordsCount(chat.content || '')

  return (
    <div className='flex items-center gap-1 -translate-x-3'>
      <Button variant={"ghost"} size="sm" disabled>
        <Clock className="size-4 hidden md:inline" />
        {dayjs(chat.createdAt).fromNow()}
      </Button>
      <Separator orientation="vertical" className="h-4" />
      {count ? (
        <>
          <Button variant={"ghost"} size="sm" disabled>
            <TypeIcon className="size-4 hidden md:inline" />
            <span>{count} {t('record.chat.messageControl.words')}</span>
          </Button>
        </>
      ) : null}
    </div>
  )
}
