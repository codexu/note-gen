"use client"
import { TooltipProvider } from "@/components/ui/tooltip"
import * as React from "react"
import { LocaleSet } from './locale-set'
import dayjs from "dayjs"
import relativeTime from 'dayjs/plugin/relativeTime'
import zh from 'dayjs/locale/zh'
import { ChevronDown, CircleAlert, Eraser } from "lucide-react"
import { useRouter } from "next/navigation";
import useSettingStore from "@/stores/setting"
import { Button } from "@/components/ui/button"
import { TooltipButton } from "@/components/tooltip-button"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { _t } from '@/locales/index';

dayjs.extend(relativeTime)
dayjs.locale(zh)

export function ChatHeader() {
  const { apiKey, model } = useSettingStore()
  const { clearChats } = useChatStore()
  const { currentTagId } = useTagStore()
  const router = useRouter()

  function handleSetting() {
    router.push('/core/setting?anchor=ai', { scroll: false });
  }

  function clearHandler() {
    clearChats(currentTagId)
  }

  return (
    <header className="h-12 w-full grid grid-cols-3 items-center border-b gap-2 px-4">
      <div className="flex items-center h-6 gap-1">
        <TooltipProvider>
          <LocaleSet />
        </TooltipProvider>
      </div>
      <div>
      <div className="flex justify-center">
        {
          (model && apiKey) ?
          <div className="flex items-center gap-1 text-sm text-zinc-500 cursor-pointer hover:underline" onClick={handleSetting}>
            {model.replace(/gpt/, 'GPT')}
            <ChevronDown className="size-4" />
          </div> :
          <div className="flex gap-1 items-center">
            <Button variant="ghost" className="text-red-800" onClick={handleSetting}>
              <CircleAlert /> {_t('config_api_key')}
            </Button>
          </div>
        }
      </div>
      </div>
      <div className="flex justify-end items-center h-6 gap-1">
        <TooltipProvider>
          <TooltipButton icon={<Eraser />} tooltipText={_t('clear_chat')} onClick={clearHandler}/>
        </TooltipProvider>
      </div>
    </header>
  )
}
