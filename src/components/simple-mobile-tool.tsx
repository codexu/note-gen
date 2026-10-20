'use client'

import { Button } from "@/components/ui/button"
import { CheckSquare, ChevronRight, ImagePlus, Link, Mic, Paperclip, Sparkles, SquarePen, Type } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

interface SimpleMobileToolProps {
  toolId: string
  onToolClick?: (toolId: string) => void
  featured?: boolean
  label?: string
  active?: boolean
}

export function SimpleMobileTool({ toolId, onToolClick, featured = false, label, active = false }: SimpleMobileToolProps) {
  const t = useTranslations()

  const getToolInfo = (id: string) => {
    switch (id) {
      case 'text':
        return { icon: <Type className="size-4" />, label: t('record.mark.type.text') }
      case 'recording':
        return { icon: <Mic className="size-4" />, label: t('record.mark.type.recording') }
      case 'image':
        return { icon: <ImagePlus className="size-4" />, label: t('record.mark.type.image') }
      case 'link':
        return { icon: <Link className="size-4" />, label: t('record.mark.type.link') }
      case 'file':
        return { icon: <Paperclip className="size-4" />, label: t('record.mark.type.file') }
      case 'todo':
        return { icon: <CheckSquare className="size-4" />, label: t('record.mark.type.todo') }
      case 'write':
        return { icon: <SquarePen className="size-4" />, label: t('navigation.write') }
      case 'organize':
        return { icon: <Sparkles className="size-4" />, label: t('record.chat.note.organize') }
      default:
        return { icon: null, label: '' }
    }
  }

  const toolInfo = getToolInfo(toolId)
  const toolLabel = label ?? toolInfo.label

  const handleClick = () => {
    if (onToolClick) {
      onToolClick(toolId)
    }
  }

  return (
    <Button
      variant="ghost"
      onClick={handleClick}
      className={cn(
        "group flex h-auto min-w-0 rounded-2xl border border-border/50 bg-background/50 text-[hsl(var(--component-inactive-color))] backdrop-blur transition-[background-color,border-color,color,transform] duration-200 hover:border-border/70 hover:bg-[hsl(var(--component-active-bg))] hover:text-foreground active:scale-[0.98]",
        active && "border-red-500/40 bg-red-500/10 text-red-600 hover:border-red-500/50 hover:bg-red-500/15 dark:text-red-400",
        featured
          ? "min-h-14 w-full justify-start gap-2.5 px-2.5 py-2.5"
          : "min-h-12 justify-start gap-2 px-2.5 py-2"
      )}
      aria-label={toolLabel}
      title={toolLabel}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--component-active-bg))] text-foreground transition-colors duration-200 group-hover:bg-background/70",
          active && "bg-red-500/15 text-red-600 dark:text-red-400",
          featured ? "size-10" : "size-9"
        )}
      >
        {toolInfo.icon}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm font-medium leading-none text-foreground"
        )}
      >
        {toolLabel}
      </span>
      {featured ? (
        <ChevronRight className="size-4 shrink-0 text-[hsl(var(--component-inactive-color))] transition-transform group-active:translate-x-0.5" />
      ) : null}
    </Button>
  )
}
