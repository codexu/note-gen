import useChatStore from '@/stores/chat'
import useTagStore from '@/stores/tag'
import { ArrowDownToLine, BotMessageSquare, ClipboardCheck, LoaderPinwheel, Undo2, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Chat } from '@/db/chats'
import ChatPreview from './chat-preview'
import './chat.scss'
import { NoteOutput } from './note-output'
import { MarkText } from './mark-text'
import { ChatClipboard } from './chat-clipboard'
import MessageControl from './message-control'
import ChatEmpty from './chat-empty'
import { useTranslations } from 'next-intl'
import useSyncStore from '@/stores/sync'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import ChatThinking from './chat-thinking'
import { Separator } from '@/components/ui/separator'
import { scrollToBottom } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import emitter from '@/lib/emitter'

export default function ChatContent() {
  const { chats, init } = useChatStore()
  const { currentTagId } = useTagStore()
  const [isOnBottom, setIsOnBottom] = useState(true)

  function handleScroll() {
    const md = document.querySelector('#chats-wrapper')
    if (!md) return
    setIsOnBottom(md.scrollHeight - md.scrollTop - md.clientHeight < 1)
  }

  useEffect(() => {
    const md = document.querySelector('#chats-wrapper')
    if (!md) return
    md.addEventListener('scroll', handleScroll)
    setTimeout(() => scrollToBottom(), 1000)
    return () => md.removeEventListener('scroll', handleScroll)
  }, [])
  
  useEffect(() => {
    init(currentTagId)
  }, [currentTagId])

  useEffect(() => {
    if (!isOnBottom) return
    scrollToBottom()
  }, [chats])

  return <div id="chats-wrapper" className="flex-1 relative overflow-y-auto overflow-x-hidden w-full flex flex-col items-end p-4 gap-6">
    {
      chats.length ? chats.map((chat) => {
        return <Message key={chat.id} chat={chat} />
      }) : <ChatEmpty />
    }
    {
      !isOnBottom && <Button variant="outline" className='sticky bottom-0 size-8 right-0' onClick={scrollToBottom}>
        <ArrowDownToLine className='size-4' />
      </Button>
    }
  </div>
}

function MessageWrapper({ chat, children }: { chat: Chat, children: React.ReactNode }) {
  const { chats, loading } = useChatStore()
  const { userInfo } = useSyncStore()

  const revertChat = () => {
    emitter.emit('revertChat', chat.content)
  }

  const index = chats.findIndex(item => item.id === chat.id)
  if (chat.role === 'system') {
    return <div className="flex w-full gap-4">
      {loading && index === chats.length - 1 && chat.type === 'chat' ?
        <LoaderPinwheel className="animate-spin" /> :
        chat.type === 'clipboard' ? <ClipboardCheck /> : <BotMessageSquare />
      }
      <div className='text-sm leading-6 flex-1 max-w-[calc(100vw-460px)] break-words'>
        {children}
      </div>
    </div>
  } else {
    return <div className="flex group items-center gap-4">
      <div className="bg-primary text-primary-foreground px-4 py-2 rounded-lg max-w-[calc(100vw-600px)]">
        {chat.content}
      </div>
      <div className="relative">
        <Avatar className='rounded size-9 flex items-center justify-center'>
          {
            userInfo?.avatar_url ?
            <AvatarImage src={userInfo?.avatar_url} /> : <UserRound />
          }
        </Avatar>
        <Button onClick={revertChat} size="icon" className="absolute top-0 right-0 hidden group-hover:flex">
          <Undo2 />
        </Button>
      </div>
    </div>
  }
}

function Message({ chat }: { chat: Chat }) {
  const t = useTranslations()
  const { deleteChat } = useChatStore()
  const content = chat.content?.includes('thinking') ? chat.content.split('<thinking>')[2] : chat.content

  const handleRemoveClearContext = () => {
    deleteChat(chat.id)
  }

  switch (chat.type) {
    case 'clear':
      return <div className="w-full flex justify-center items-center gap-4 px-10">
        <Separator className='flex-1' />
        <div className="flex justify-center items-center gap-2 w-32 group h-8">
          <p className="text-sm text-center text-muted-foreground">{t('record.chat.input.clearContext.tooltip')}</p>
          <X className="size-4 hidden group-hover:flex cursor-pointer" onClick={handleRemoveClearContext} />
        </div>
        <Separator className='flex-1' />
      </div>

    case 'clipboard':
      return <MessageWrapper chat={chat}>
        <ChatClipboard chat={chat} />
      </MessageWrapper>

    case 'note':
      return <MessageWrapper chat={chat}>
        {
          <div className='w-full overflow-x-hidden'>
            <div className='flex justify-between'>
              <p>{t('record.chat.content.organize')}</p>
            </div>
            <ChatThinking chat={chat} />
            {
              <div className={`${content ? 'note-wrapper border w-full overflow-y-auto overflow-x-hidden my-2 p-4 rounded-lg' : ''}`}>
                <ChatPreview text={content || ''} />
              </div>
            }
            <MessageControl chat={chat}>
              <NoteOutput chat={chat} />
            </MessageControl>
          </div>
        }
      </MessageWrapper>

    default:
      return <MessageWrapper chat={chat}>
        <ChatThinking chat={chat} />
        <ChatPreview text={content || ''} />
        <MessageControl chat={chat}>
          <MarkText chat={chat} />
        </MessageControl>
      </MessageWrapper>
  }
}
