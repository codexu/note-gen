import * as React from "react"
import { MessageCircle, FileText, Languages } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTranslations } from "next-intl"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface InputModeSelectProps {
  value: string
  onChange: (value: string) => void
}

const inputModes = [
  {
    value: 'chat',
    icon: MessageCircle,
    labelKey: 'chat'
  },
  {
    value: 'translate',
    icon: Languages,
    labelKey: 'translate'
  },
  {
    value: 'gen',
    icon: FileText,
    labelKey: 'organize'
  },
]

export function InputModeSelect({ value, onChange }: InputModeSelectProps) {
  const t = useTranslations('record.chat.input.modeSelect')

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Tabs value={value} onValueChange={onChange}>
            <TabsList className="h-8">
              {inputModes.map((mode) => {
                const Icon = mode.icon
                return (
                  <TabsTrigger
                    key={mode.value}
                    value={mode.value}
                    className="px-1.5 py-1 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow"
                  >
                    <Icon className="size-4" />
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t(value)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
