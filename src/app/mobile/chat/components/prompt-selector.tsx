"use client"

import * as React from "react"
import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { Drama } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function PromptSelector() {
  const { promptList, currentPrompt, initPromptData, setCurrentPrompt } = usePromptStore()
  const t = useTranslations('record.chat.input.promptSelect')

  useEffect(() => {
    initPromptData()
  }, [])

  async function promptSelectChangeHandler(id: string) {
    const selectedPrompt = promptList.find(item => item.id === id)
    if (!selectedPrompt) return
    await setCurrentPrompt(selectedPrompt)
  }

  return (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <Drama className="size-4" />
        <Label className="text-sm font-medium">{t('tooltip')}</Label>
      </div>
      <Select value={currentPrompt?.id} onValueChange={promptSelectChangeHandler}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={t('tooltip')} />
        </SelectTrigger>
        <SelectContent>
          {promptList?.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
