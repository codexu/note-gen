import * as React from "react"
import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { ChatToolItem } from "./chat-tool-item"

interface PromptSelectProps {
  display?: 'icon' | 'status' | 'panel'
  disabled?: boolean
}

export function PromptSelect({ display = 'icon', disabled = false }: PromptSelectProps) {
  const { promptList, currentPrompt, initPromptData, setCurrentPrompt } = usePromptStore()
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input.promptSelect')
  const tTools = useTranslations('record.chat.input.toolsMenu')

  // 初始化prompt列表
  useEffect(() => {
    initPromptData()
  }, [])

  // 选择 Prompt
  async function promptSelectChangeHandler(id: string) {
    const selectedPrompt = promptList.find(item => item.id === id)
    if (!selectedPrompt) return
    await setCurrentPrompt(selectedPrompt)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {display === 'status' ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled}
            className="h-5 min-w-0 max-w-36 gap-1 px-1 text-xs font-normal text-muted-foreground"
            aria-label={t('tooltip')}
          >
            <Drama data-icon="inline-start" />
            <span className="truncate">{currentPrompt?.title || '-'}</span>
          </Button>
        ) : display === 'panel' ? (
          <ChatToolItem
            icon={Drama}
            title={tTools('prompt.title')}
            description={tTools('prompt.description')}
            disabled={disabled}
            value={<span title={currentPrompt?.title}>{currentPrompt?.title || '-'}</span>}
          />
        ) : (
          <div className="hidden md:block">
            <TooltipButton
              icon={<Drama />}
              tooltipText={t('tooltip')}
              size="icon"
            />
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={display === 'icon' ? 'center' : display === 'status' ? 'end' : 'start'}
        side={display === 'panel' ? 'right' : undefined}
        className="w-[220px] p-0"
      >
        <Command>
          <CommandInput placeholder={t('tooltip')} className="h-9" />
          <CommandList>
            <CommandGroup>
              {promptList?.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  data-checked={currentPrompt?.id === item.id}
                  onSelect={(currentValue) => {
                    promptSelectChangeHandler(currentValue)
                    setOpen(false)
                  }}
                >
                  {item.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
