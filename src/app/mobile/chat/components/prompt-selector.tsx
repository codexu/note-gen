"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, ChevronRight } from "lucide-react"
import usePromptStore from "@/stores/prompt"
import { Label } from "@/components/ui/label"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from "@/lib/utils"

function PromptListContent({
  promptList,
  currentPromptId,
  onSelect,
}: {
  promptList: { id: string; title: string }[]
  currentPromptId?: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="space-y-1">
      {promptList.map((item) => {
        const isSelected = currentPromptId === item.id

        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={cn(
              "w-full flex items-center justify-between gap-3 px-3 py-3 rounded-lg text-left transition-colors",
              isSelected ? "bg-accent" : "hover:bg-muted/50"
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate">{item.title}</div>
            </div>
            <div
              className={cn(
                "flex items-center justify-center w-5 h-5 rounded border transition-colors shrink-0",
                isSelected
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-muted-foreground/30"
              )}
            >
              {isSelected && <Check className="size-3.5" />}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function PromptSelector() {
  const { promptList, currentPrompt, initPromptData, setCurrentPrompt } = usePromptStore()
  const [open, setOpen] = useState(false)
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
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-16 flex items-center justify-between w-full px-0"
      >
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{t('tooltip')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground truncate max-w-40">
            {currentPrompt?.title || t('tooltip')}
          </span>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </div>
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[70vh]">
          <DrawerHeader>
            <DrawerTitle>{t('tooltip')}</DrawerTitle>
          </DrawerHeader>
          <div className="p-4">
            <PromptListContent
              promptList={promptList.map(({ id, title }) => ({ id, title }))}
              currentPromptId={currentPrompt?.id}
              onSelect={async (id) => {
                await promptSelectChangeHandler(id)
                setOpen(false)
              }}
            />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
