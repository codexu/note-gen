import { Button } from "@/components/ui/button"
import { Chat } from "@/db/chats"
import dayjs from "dayjs"
import { Clock } from "lucide-react"
import relativeTime from "dayjs/plugin/relativeTime"

dayjs.extend(relativeTime)

interface MessageInfoProps {
  chat: Chat
}

export function MessageInfo({ chat }: MessageInfoProps) {

  return (
    <div className='flex items-center gap-1 -translate-x-3'>
      <Button variant={"ghost"} size="sm" disabled>
        <Clock className="size-4 hidden md:inline" />
        {dayjs(chat.createdAt).fromNow()}
      </Button>
    </div>
  )
}
