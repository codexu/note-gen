import * as React from "react"
import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { ChevronRight, Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { TooltipButton } from "@/components/tooltip-button"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"

interface PromptSelectProps {
  display?: 'icon' | 'status' | 'panel'
  disabled?: boolean
}

export function PromptSelect({ display = 'icon', disabled = false }: PromptSelectProps) {
  const { promptList, currentPrompt, initPromptData, setCurrentPrompt } = usePromptStore()
  const [open, setOpen] = React.useState(false)
  const t = useTranslations('record.chat.input.promptSelect')

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
          <Item asChild size="sm" className="min-h-10 flex-nowrap py-2 cursor-pointer hover:bg-muted">
            <button type="button" disabled={disabled}>
              <ItemContent className="min-w-0">
                <ItemTitle className="min-w-0 truncate">{t('tooltip')}</ItemTitle>
              </ItemContent>
              <ItemActions className="shrink-0">
                <span className="max-w-28 truncate text-xs text-muted-foreground" title={currentPrompt?.title}>
                  {currentPrompt?.title || '-'}
                </span>
                <ChevronRight />
              </ItemActions>
            </button>
          </Item>
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
