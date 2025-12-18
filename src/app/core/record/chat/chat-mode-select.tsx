import * as React from "react"
import { MessageCircle, Bot, Check } from "lucide-react"
import { useTranslations } from "next-intl"
import useChatStore from "@/stores/chat"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

const chatModes = [
  {
    value: 'chat',
    icon: MessageCircle,
    label: 'Chat',
    descriptionKey: 'chatDescription'
  },
  {
    value: 'agent',
    icon: Bot,
    label: 'Agent',
    descriptionKey: 'agentDescription'
  },
]

export function ChatModeSelect() {
  const t = useTranslations('record.chat.input.chatModeSelect')
  const { chatMode, setChatMode } = useChatStore()
  
  const currentMode = chatModes.find(m => m.value === chatMode)
  const CurrentIcon = currentMode?.icon || MessageCircle

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 gap-1.5">
          <CurrentIcon className="size-4" />
          <span className="text-xs font-medium">{currentMode?.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {chatModes.map((mode) => {
          const Icon = mode.icon
          const isActive = chatMode === mode.value
          return (
            <DropdownMenuItem
              key={mode.value}
              onClick={() => setChatMode(mode.value as 'chat' | 'agent')}
              className="flex items-start gap-2 cursor-pointer"
            >
              <Icon className="size-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{mode.label}</span>
                  {isActive && <Check className="size-3.5 ml-auto" />}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t(mode.descriptionKey)}
                </p>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
