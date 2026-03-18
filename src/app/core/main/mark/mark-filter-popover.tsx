"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Filter, RotateCcw, Search } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toggle } from "@/components/ui/toggle"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import useMarkStore, { RecordTimePreset } from "@/stores/mark"
import { cn } from "@/lib/utils"
import { getMarkTypeChipClasses, MARK_TYPE_OPTIONS } from "./mark-type-meta"
const TIME_OPTIONS: RecordTimePreset[] = ['all', 'today', 'last7Days', 'last30Days']

export function MarkFilterPopover() {
  const [open, setOpen] = useState(false)
  const t = useTranslations('record.mark')
  const {
    recordFilters,
    setRecordSearch,
    toggleRecordType,
    setRecordTimePreset,
    resetRecordFilters,
    hasActiveRecordFilters,
  } = useMarkStore()

  const isActive = hasActiveRecordFilters()

  const handleClear = () => {
    resetRecordFilters()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant={isActive ? "default" : "ghost"}
                size="icon"
                className="relative"
                aria-label={t('toolbar.filter.title')}
              >
                <Filter className="h-4 w-4" />
                {isActive ? (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-background/90" />
                ) : null}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('toolbar.filter.title')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent side="right" align="start" sideOffset={12} className="w-[320px] rounded-xl border-border/60 bg-popover/95 p-4 shadow-lg">
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-sm font-semibold">{t('toolbar.filter.title')}</div>
            <p className="text-xs text-muted-foreground">{t('toolbar.filter.description')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="record-filter-search" className="text-xs uppercase tracking-wide text-muted-foreground">{t('toolbar.filter.search')}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="record-filter-search"
                value={recordFilters.search}
                onChange={(event) => setRecordSearch(event.target.value)}
                placeholder={t('toolbar.filter.searchPlaceholder')}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t('toolbar.filter.time')}</Label>
            <div className="flex flex-wrap gap-2">
              {TIME_OPTIONS.map((preset) => (
                <Toggle
                  key={preset}
                  pressed={recordFilters.timePreset === preset}
                  size="sm"
                  onClick={() => setRecordTimePreset(preset)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-xs font-medium shadow-none",
                    recordFilters.timePreset === preset
                      ? "border-primary/30 bg-primary/8 text-foreground hover:bg-primary/10"
                      : "border-border/70 bg-muted/35 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  {t(`toolbar.filter.timeOptions.${preset}`)}
                </Toggle>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t('toolbar.filter.type')}</Label>
            <div className="flex flex-wrap gap-2">
              {MARK_TYPE_OPTIONS.map((type) => (
                <Toggle
                  key={type}
                  pressed={recordFilters.selectedTypes.includes(type)}
                  onPressedChange={() => toggleRecordType(type)}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 rounded-full px-3 text-xs font-medium shadow-none",
                    getMarkTypeChipClasses(type, recordFilters.selectedTypes.includes(type))
                  )}
                  aria-label={t(`type.${type}`)}
                >
                  {t(`type.${type}`)}
                </Toggle>
              ))}
            </div>
          </div>

          <Separator />

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={!isActive}
              className="gap-2"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('toolbar.filter.clear')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
