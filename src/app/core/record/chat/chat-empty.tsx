import { Bot, NotebookPen, Clipboard, Link } from 'lucide-react'
import { _t } from '@/locales/index';

export default function ChatEmpty() {
  const list = [
    {
      content: <p>{_t('chat_empty_chat_with_ai')}</p>,
      icon: <Bot className='size-4' />
    },
    {
      content: <p>{_t('chat_empty_associated_with_record')}</p>,
      icon: <Link className='size-4' />
    },
    {
      content: <p>{_t('chat_empty_identify_clipboard_record')}</p>,
      icon: <Clipboard className='size-4' />
    },
    {
      content: <p>{_t('chat_empty_organize_record_to_note')}</p>,
      icon: <NotebookPen className='size-4' />
    },
  ]
  return <div className="flex flex-col justify-center items-center flex-1 w-full">
    <Bot className='size-36 opacity-10 mb-4' />
    <div className='flex flex-col gap-4 my-2'>
      {
        list.map((item, index) => {
          return <div key={index} className='border rounded-lg flex items-center gap-2 px-6 py-2 text-sm text-zinc-500 opacity-70'>
            {item.icon}
            {item.content}
          </div>
        })
      }
    </div>
  </div>
}
